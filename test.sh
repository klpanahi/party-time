#!/usr/bin/env bash
# Runs the full party-time test suite: backend Go tests + both frontend
# Vitest suites, against a throwaway test Postgres. Exits non-zero if
# anything fails. Extracted from build.sh so it can be run standalone (e.g.
# by e2e.sh's own build step, or by a developer who just wants tests) without
# also cross-building the backend image.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

# Ensure postgres is stopped on exit (success or failure).
cleanup() {
  echo ""
  echo "Stopping test database..."
  docker compose -f "$ROOT/docker-compose.yml" stop postgres-db 2>/dev/null || true
}
trap cleanup EXIT

echo "=== party-time test ==="
echo ""

# ── 1. Test database ─────────────────────────────────────────────────────────
echo "[1/4] Starting test database..."
docker compose -f "$ROOT/docker-compose.yml" up -d postgres-db
until docker compose -f "$ROOT/docker-compose.yml" exec -T postgres-db pg_isready -q 2>/dev/null; do
  sleep 0.5
done
echo "      Ready."

# ── 2. Backend tests ──────────────────────────────────────────────────────────
echo "[2/4] Running backend tests..."
(cd "$ROOT/public_backend" && go test ./... -count=1)
echo "      Passed."

# ── 3. Admin UI: install, test ────────────────────────────────────────────────
echo "[3/4] Running admin UI tests..."
(cd "$ROOT/admin_ui" && npm ci --silent && npx vitest run)
echo "      Passed."

# ── 4. Invitee UI: install, test ─────────────────────────────────────────────
echo "[4/4] Running invitee UI tests..."
(cd "$ROOT/invitee_ui" && npm ci --silent && npx vitest run)
echo "      Passed."

echo ""
echo "=== All tests passed ==="
