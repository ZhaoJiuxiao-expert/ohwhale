#!/usr/bin/env bash
# Review before running on the NEW Ubuntu host. No remote access or cloud API.
set -euo pipefail
umask 077
action="${1:---check}"
if [[ "$action" == --help ]]; then
  printf '%s\n' 'Use --check (read only) or --install-dependencies (root; new Ubuntu22.04 amd64 only).'
  exit 0
fi
[[ "$action" == --check || "$action" == --install-dependencies ]] || { echo 'Unknown action' >&2; exit 1; }
[[ $EUID -eq 0 ]] || { echo 'Run as root on the NEW Ubuntu host.' >&2; exit 1; }
source /etc/os-release
[[ "$ID" == ubuntu && "$VERSION_ID" == 22.04 && "$(dpkg --print-architecture)" == amd64 ]] || { echo 'This bootstrap is only for Ubuntu22.04 amd64; no OS changes attempted.' >&2; exit 1; }
if [[ "$action" == --check ]]; then
  printf '%s\n' 'Ubuntu22.04 amd64 confirmed. No configuration, package or firewall changes made.'
  command -v node >/dev/null && node --version || true
  command -v docker >/dev/null && docker --version || true
  command -v docker >/dev/null && docker compose version || true
  exit 0
fi
# Preserve any existing software/configuration rather than remove or replace it.
for package in docker.io docker-compose docker-compose-v2 docker-doc docker-buildx podman-docker containerd runc docker-ce docker-ce-cli containerd.io; do
  if dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -qx 'install ok installed'; then
    echo 'Existing container runtime/package detected; stop and review it, do not uninstall automatically.' >&2
    exit 1
  fi
done
for existing in /etc/apt/keyrings/ohwhale-docker.asc /etc/apt/sources.list.d/ohwhale-docker.sources /usr/local/bin/node; do
  [[ ! -e "$existing" && ! -L "$existing" ]] || { echo 'Existing bootstrap target preserved; review before retrying.' >&2; exit 1; }
done
if command -v node >/dev/null 2>&1; then echo 'Existing Node installation preserved; review it before using this fresh-host installer.' >&2; exit 1; fi
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl gnupg xz-utils tar coreutils
work="$(mktemp -d /var/tmp/ohwhale-bootstrap.XXXXXXXX)"
chmod 0700 "$work"
cd "$work"
fetch() { curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --tlsv1.2 "$1" --output "$2"; }
# Official Docker repository and Signed-By isolation, per Docker's Ubuntu guide.
install -m 0755 -d /etc/apt/keyrings
fetch https://download.docker.com/linux/ubuntu/gpg docker.asc
gpg --batch --show-keys docker.asc >/dev/null 2>&1
install -m 0644 docker.asc /etc/apt/keyrings/ohwhale-docker.asc
( set -o noclobber; cat > /etc/apt/sources.list.d/ohwhale-docker.sources <<'EOF'
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: jammy
Components: stable
Architectures: amd64
Signed-By: /etc/apt/keyrings/ohwhale-docker.asc
EOF
)
apt-get update
apt-get install -y --no-install-recommends docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
# Verify signed Node24 checksums before selecting/downloading the exact release.
# These primary fingerprints are pinned from nodejs/release-keys active list.
install -m 0700 -d "$work/gnupg"
export GNUPGHOME="$work/gnupg"
keys=(
  5BE8A3F6C8A5C01D106C0AD820B1A390B168D356
  DD792F5973C6DE52C432CBDAC77ABFA00DDBF2B7
  CC68F5A3106FF448322E48ED27F5E38D5B0A215F
  890C08DB8579162FEE0DF9DB8BEAB4DFCF555EF4
  C82FA3AE1CBEDC6BE46B9360C43CEC45C17AB93C
  108F52B48DB57BB0CC439B2997B01419BD92F80A
  655F3B5C1FB3FA8D1A0CA6BDE4A7D232B936D2FD
  A363A499291CBBC940DD62E41F10027AF002F8B0
)
for fingerprint in "${keys[@]}"; do
  fetch "https://raw.githubusercontent.com/nodejs/release-keys/HEAD/keys/$fingerprint.asc" "$fingerprint.asc"
  actual="$(gpg --batch --with-colons --show-keys "$fingerprint.asc" 2>/dev/null | awk -F: '$1=="fpr" && !seen {print $10;seen=1}')"
  [[ "$actual" == "$fingerprint" ]] || { echo 'Node release-key fingerprint mismatch.' >&2; exit 1; }
  gpg --batch --import "$fingerprint.asc" >/dev/null 2>&1
done
fetch https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt SHASUMS256.txt
fetch https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt.sig SHASUMS256.txt.sig
gpg --batch --no-auto-key-retrieve --verify SHASUMS256.txt.sig SHASUMS256.txt >/dev/null 2>&1 || { echo 'Signed Node24 checksums failed verification; no binary executed.' >&2; exit 1; }
mapfile -t candidates < <(awk '$2 ~ /^node-v24\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz$/ {print $2}' SHASUMS256.txt)
[[ ${#candidates[@]} -eq 1 ]] || { echo 'Expected exactly one signed Node24 Linux x64 artifact.' >&2; exit 1; }
archive="${candidates[0]}"
version="${archive#node-}"; version="${version%-linux-x64.tar.xz}"
fetch "https://nodejs.org/dist/$version/$archive" "$archive"
awk -v artifact="$archive" '$2==artifact {print}' SHASUMS256.txt > node-selected.sha256
sha256sum --check --strict node-selected.sha256
target="/opt/ohwhale-node/${archive%.tar.xz}"
[[ ! -e "$target" && ! -L "$target" ]] || { echo 'Existing Node target preserved.' >&2; exit 1; }
install -m 0755 -d /opt/ohwhale-node
( umask 022; tar --extract --xz --file "$archive" --directory /opt/ohwhale-node --no-same-owner --no-same-permissions )
"$target/bin/node" -e 'if(!process.version.startsWith("v24."))process.exit(1)'
ln -s "$target/bin/node" /usr/local/bin/node
systemctl enable --now docker
node --version
docker --version
docker compose version
printf '%s\n' "Verified public dependency downloads retained in $work" 'Dependency installation complete. No app ports, firewall rules, ACME agreement, owner tokens or TURN secrets configured.'
