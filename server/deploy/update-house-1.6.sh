#!/usr/bin/env bash
set -euo pipefail
umask 077
[ "${1:-}" = '--publish-terms' ] || { echo 'Use --publish-terms after reviewing the agreement.' >&2; exit 2; }
[ "$(id -u)" = '0' ] || exit 1
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
target=/opt/ohwhale-network
[ -d "$target" ] && [ ! -L "$target" ] && [ ! -L "$target/server" ] || exit 1
cd "$target"
for file in compose.ip.yaml compose.update-managed.yaml compose.groups.yaml secrets.env Caddyfile .dockerignore; do
 [ -f "$file" ] && [ ! -L "$file" ] || exit 1
done
for exclusion in runtime/ secrets.env turnserver.conf; do grep -Fxq "$exclusion" .dockerignore || exit 1; done
files=(server/signaling.cjs server/terms.html server/Dockerfile server/managed-ai.cjs)
for file in "${files[@]}"; do [ -f "$source_dir/$file" ] && [ ! -L "$source_dir/$file" ] && [ ! -L "$target/$file" ] || exit 1; done
backup_root=/opt/ohwhale-backups
[ -d "$backup_root" ] && [ ! -L "$backup_root" ] && [ "$(stat -c '%u:%a' "$backup_root")" = '0:700' ] || exit 1
backup=$(mktemp -d "$backup_root/house-update-XXXXXXXX")
for file in "${files[@]}"; do
 if [ -e "$file" ]; then mkdir -p "$backup/$(dirname "$file")"; cp -p -- "$file" "$backup/$file"; fi
done
printf 'Code backup: %s\n' "$backup"
for file in "${files[@]}"; do cp -p -- "$source_dir/$file" "$file"; done
docker compose -f compose.ip.yaml -f compose.update-managed.yaml -f compose.groups.yaml config --quiet
docker compose -f compose.ip.yaml -f compose.update-managed.yaml -f compose.groups.yaml build signaling
docker compose -f compose.ip.yaml -f compose.update-managed.yaml -f compose.groups.yaml up -d --no-deps --force-recreate signaling
printf '%s\n' 'Existing service updated. Verify HTTPS /terms and /health. Data and credentials unchanged.'
