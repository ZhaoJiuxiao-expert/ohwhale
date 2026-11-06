#!/usr/bin/env bash
# Explicit operator action. Does not upload, provision a key, or modify TLS/TURN.
set -euo pipefail
umask 077
if [ "$#" -ne 1 ] || [ "$1" != "--enable-managed" ]; then
  printf '%s\n' 'Use --enable-managed only after the explicit activation approval and private key provisioning.' >&2
  exit 2
fi
[ "$(id -u)" -eq 0 ] || { printf '%s\n' 'Run as root.' >&2; exit 1; }
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
target=/opt/ohwhale-network
[ -d "$target" ] && [ ! -L "$target" ] || { printf '%s\n' 'Expected existing deployment directory.' >&2; exit 1; }
cd "$target"
[ -f compose.ip.yaml ] && [ ! -L compose.ip.yaml ] && [ -f secrets.env ] && [ ! -L secrets.env ] && [ -f Caddyfile ] && [ ! -L Caddyfile ] || { printf '%s\n' 'Existing deployment prerequisites missing.' >&2; exit 1; }
[ -f .dockerignore ] && [ ! -L .dockerignore ] && grep -Fxq 'runtime/' .dockerignore && grep -Fxq 'secrets.env' .dockerignore && grep -Fxq 'turnserver.conf' .dockerignore || { printf '%s\n' 'Existing Docker context exclusions are insufficient.' >&2; exit 1; }
key=runtime/managed-key
[ -f "$key" ] && [ ! -L "$key" ] && [ "$(stat -c '%u:%g:%a' "$key")" = '1000:1000:600' ] && [ "$(stat -c '%s' "$key")" -gt 0 ] && [ "$(stat -c '%s' "$key")" -le 4096 ] || { printf '%s\n' 'Managed key must already be a private 1000:1000 0600 regular file of 1-4096 bytes.' >&2; exit 1; }
files=(server/signaling.cjs server/friends.cjs server/managed-ai.cjs server/managed-models.json server/check.html server/check.js server/Dockerfile src/p2p/network.js src/p2p/peer.js compose.update-managed.yaml)
for file in "${files[@]}" prepare-friends-data.cjs prepare-managed-data.cjs; do
 [ -f "$source_dir/$file" ] && [ ! -L "$source_dir/$file" ] || { printf '%s\n' 'Update bundle incomplete.' >&2; exit 1; }
 [ ! -L "$target/$file" ] || { printf '%s\n' 'Target has a symbolic-link file; preserve it and stop.' >&2; exit 1; }
done
[ ! -L server ] && [ ! -L src ] && [ ! -L src/p2p ] || { printf '%s\n' 'Target code directory is a symbolic link.' >&2; exit 1; }
backup_root=/opt/ohwhale-backups
if [ ! -e "$backup_root" ]; then mkdir -m 0700 "$backup_root"; fi
[ -d "$backup_root" ] && [ ! -L "$backup_root" ] && [ "$(stat -c '%u:%a' "$backup_root")" = '0:700' ] || { printf '%s\n' 'Backup root must be root-owned 0700.' >&2; exit 1; }
backup=$(mktemp -d "$backup_root/managed-update-XXXXXXXX")
chmod 0700 "$backup"
for file in "${files[@]}" compose.ip.yaml; do
 if [ -e "$file" ]; then mkdir -p "$backup/$(dirname "$file")"; cp -p -- "$file" "$backup/$file"; printf 'existing %s\n' "$file" >> "$backup/manifest.txt"; else printf 'absent %s\n' "$file" >> "$backup/manifest.txt"; fi
done
printf 'Backup prepared at %s\n' "$backup"
node "$source_dir/prepare-friends-data.cjs"
node "$source_dir/prepare-managed-data.cjs"
for file in "${files[@]}"; do mkdir -p "$(dirname "$file")"; cp -p -- "$source_dir/$file" "$file"; done
docker compose -f compose.ip.yaml -f compose.update-managed.yaml config --quiet
docker compose -f compose.ip.yaml -f compose.update-managed.yaml build signaling
docker compose -f compose.ip.yaml -f compose.update-managed.yaml up -d --no-deps --force-recreate signaling
printf '%s\n' 'Signaling update requested. Verify service health and model availability separately.'
