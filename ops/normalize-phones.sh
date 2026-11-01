#!/usr/bin/env bash
#
# Backfill contact phone numbers to "+1 (512)350-0064" through the admin API
# (card #27).
#
# GETs every contact and PUTs each one whose number isn't normalized yet back
# unchanged, so the backend's own normalization rewrites it. No SQL.
#
#   ops/normalize-phones.sh           # dry run: GET only, lists what would change
#                                     # and which numbers won't parse
#   ops/normalize-phones.sh --apply   # PUT the changes (live data — only after the
#                                     # normalizing backend is deployed)
#
# Targets $PARTY_TIME_ADMIN_URL (default from deploy/hosts.env). Exits 1 when a
# number won't parse, collides with another contact, or a PUT fails; those are
# listed for a hand fix in the admin UI. The logic lives in
# public_backend/cmd/normalize-phones so the dry run uses the backend's rule.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../deploy/hosts.env
. "$ROOT/deploy/hosts.env"

args=()
case "${1:-}" in
  "") ;;
  --apply) args+=(-apply) ;;
  *) echo "usage: $0 [--apply]" >&2; exit 2 ;;
esac

cd "$ROOT/public_backend"
exec go run ./cmd/normalize-phones -url "$PARTY_TIME_ADMIN_URL" "${args[@]+"${args[@]}"}"
