#!/usr/bin/env bash
# Updates the existing OhWhale service, retaining TLS, TURN, credentials and old files.
set -euo pipefail
umask 077
[ "$#" -eq 1 ] && [ "$1" = "--enable-groups" ] || { printf '%s\n' 'Review group cloud storage and run with --enable-groups.' >&2; exit 2; }
[ "$(id -u)" -eq 0 ] || { printf '%s\n' 'Run as root.' >&2; exit 1; }
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
target=/opt/ohwhale-network
[ -d "$target" ] && [ ! -L "$target" ] || { printf '%s\n' 'Expected existing OhWhale deployment.' >&2; exit 1; }
cd "$target"
for file in compose.ip.yaml compose.update-managed.yaml secrets.env Caddyfile .dockerignore; do
 [ -f "$file" ] && [ ! -L "$file" ] || { printf '%s\n' 'Existing deployment prerequisites missing.' >&2; exit 1; }
done
for exclusion in runtime/ secrets.env turnserver.conf; do grep -Fxq "$exclusion" .dockerignore || { printf '%s\n' 'Private Docker context exclusions missing.' >&2; exit 1; }; done
files=(server/signaling.cjs server/groups.cjs server/moments.cjs server/friends.cjs server/managed-ai.cjs server/managed-models.json server/check.html server/check.js server/Dockerfile src/p2p/network.js src/p2p/peer.js compose.groups.yaml)
for file in "${files[@]}"; do
 [ -f "$source_dir/$file" ] && [ ! -L "$source_dir/$file" ] && [ ! -L "$target/$file" ] || { printf '%s\n' 'Group update bundle incomplete or unsafe link present.' >&2; exit 1; }
done
[ ! -L server ] && [ ! -L src ] && [ ! -L src/p2p ] && [ ! -L runtime ] || exit 1
backup_root=/opt/ohwhale-backups
if [ ! -e "$backup_root" ]; then mkdir -m 0700 "$backup_root"; fi
[ -d "$backup_root" ] && [ ! -L "$backup_root" ] && [ "$(stat -c '%u:%a' "$backup_root")" = '0:700' ] || exit 1
backup=$(mktemp -d "$backup_root/groups-update-XXXXXXXX")
for file in "${files[@]}"; do
 if [ -e "$file" ]; then mkdir -p "$backup/$(dirname "$file")"; cp -p -- "$file" "$backup/$file"; printf 'existing %s\n' "$file" >> "$backup/manifest.txt"; else printf 'absent %s\n' "$file" >> "$backup/manifest.txt"; fi
done
printf 'Code backup: %s\n' "$backup"
if [ ! -e runtime/groups ]; then mkdir -m 0700 runtime/groups; chown 1000:1000 runtime/groups; fi
[ -d runtime/groups ] && [ ! -L runtime/groups ] && [ "$(stat -c '%u:%g:%a' runtime/groups)" = '1000:1000:700' ] || { printf '%s\n' 'Existing group data permissions require inspection; no automatic broad chmod.' >&2; exit 1; }
if [ ! -e runtime/moments ]; then mkdir -m 0700 runtime/moments; chown 1000:1000 runtime/moments; fi
[ -d runtime/moments ] && [ ! -L runtime/moments ] && [ "$(stat -c '%u:%g:%a' runtime/moments)" = '1000:1000:700' ] || { printf '%s\n' 'Existing moments data permissions require inspection.' >&2; exit 1; }
for file in "${files[@]}"; do mkdir -p "$(dirname "$file")"; cp -p -- "$source_dir/$file" "$file"; done
docker compose -f compose.ip.yaml -f compose.update-managed.yaml -f compose.groups.yaml config --quiet
docker compose -f compose.ip.yaml -f compose.update-managed.yaml -f compose.groups.yaml build signaling
docker compose -f compose.ip.yaml -f compose.update-managed.yaml -f compose.groups.yaml up -d --no-deps --force-recreate signaling
printf '%s\n' 'Group update requested. Verify public HTTPS health, authorization, multi-device messages and old friend/model routes.'
