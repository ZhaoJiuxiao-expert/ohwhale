#!/usr/bin/env bash
# Run from a fresh, verified white-list package on the NEW Linux server only.
set -euo pipefail
umask 077
action="${1:---help}"
if [[ "$action" == --help ]]; then
  printf '%s\n' 'Actions: --configure, --deploy, --issue-ip-certificate, --renewal, --status' 'Review UBUNTU-BOOTSTRAP.md. Each action is explicit; nothing is uploaded by this script.'
  exit 0
fi
[[ $EUID -eq 0 ]] || { echo 'Run as root.' >&2; exit 1; }
source /etc/os-release
[[ "$ID" == ubuntu && "$VERSION_ID" == 22.04 && "$(dpkg --print-architecture)" == amd64 ]] || { echo 'Expected new Ubuntu22.04 amd64 host.' >&2; exit 1; }
node -e 'if(!process.version.startsWith("v24."))process.exit(1)'
[[ -f ./configure.cjs && -f ./preflight.cjs && -f ./compose.ip.yaml ]] || { echo 'Enter the verified deployment directory first.' >&2; exit 1; }
ports_approved() { [[ "${OH_NETWORK_PORTS_APPROVED:-}" == yes ]] || { echo 'Root must first confirm the new instance security-group/firewall rules, then set OH_NETWORK_PORTS_APPROVED=yes.' >&2; exit 1; }; }
case "$action" in
  --configure)
    : "${OH_PUBLIC_IP:?Set the NEW Linux instance fixed public IPv4; never reuse the old Windows IP}"
    export OH_HTTPS_MODE=ip
    node configure.cjs
    node preflight.cjs
    ;;
  --deploy)
    ports_approved
    node preflight.cjs
    docker compose -f compose.ip.yaml config --quiet
    node ip-https.cjs bootstrap
    ;;
  --issue-ip-certificate)
    ports_approved
    [[ "${OH_CA_TERMS_APPROVED:-}" == yes ]] || { echo 'CA terms are separate from ECS terms; root must confirm them before setting OH_CA_TERMS_APPROVED=yes.' >&2; exit 1; }
    : "${OH_ACME_EMAIL:?Set an explicitly supplied operator email for the ACME account}"
    node preflight.cjs
    node ip-https.cjs stage --agree-tos
    node ip-https.cjs issue --agree-tos
    node ip-https.cjs status
    ;;
  --renewal)
    node preflight.cjs
    [[ -x /usr/local/bin/node ]] || { echo 'Renewal requires the bootstrap-installed /usr/local/bin/node.' >&2; exit 1; }
    /usr/local/bin/node -e 'if(!process.version.startsWith("v24."))process.exit(1)'
    [[ ! -e /etc/systemd/system/ohwhale-ip-renew.service && ! -e /etc/systemd/system/ohwhale-ip-renew.timer ]] || { echo 'Existing renewal units preserved; review instead of overwrite.' >&2; exit 1; }
    node ip-https.cjs units
    systemd-analyze verify ./ohwhale-ip-renew.service ./ohwhale-ip-renew.timer
    node ip-https.cjs renew-test
    install -m 0644 ohwhale-ip-renew.service /etc/systemd/system/ohwhale-ip-renew.service
    install -m 0644 ohwhale-ip-renew.timer /etc/systemd/system/ohwhale-ip-renew.timer
    systemctl daemon-reload
    systemctl start ohwhale-ip-renew.service
    systemctl enable --now ohwhale-ip-renew.timer
    node ip-https.cjs renewal-status
    ;;
  --status)
    node preflight.cjs
    node ip-https.cjs status
    ;;
  *) echo 'Unknown action.' >&2; exit 1 ;;
esac
