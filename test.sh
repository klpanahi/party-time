#!/usr/bin/env bash
# Runs the full party-time test suite: backend Go tests + both frontend
# Vitest suites, against a throwaway test Postgres. Exits non-zero if
# anything fails. Extracted from build.sh so it can be run standalone (e.g.
# by e2e.sh's own build step, or by a developer who just wants tests) without
# also cross-building the backend image.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

# A compose project of its own per checkout (hash of the checkout path), on a
# free host port, so test runs from the main checkout and from worktrees run
# side by side without touching each other or run_local.sh's dev database.
PROJECT="party-time-test-$(printf '%s' "$ROOT" | shasum | cut -c1-8)"
COMPOSE=(docker compose -p "$PROJECT" -f "$ROOT/docker-compose.yml")

# Remove the test database, its network and its volume on exit (success or
# failure), so nothing is left behind.
cleanup() {
  echo ""
  echo "Removing test database..."
  "${COMPOSE[@]}" down -v --remove-orphans 2>/dev/null || true
}
trap cleanup EXIT

echo "=== party-time test ==="
echo ""

# ── 1. Test database ─────────────────────────────────────────────────────────
echo "[1/4] Starting test database..."
PARTY_TIME_DB_PORT=0 "${COMPOSE[@]}" up -d postgres-db
# -h 127.0.0.1: the image's first-boot init server listens on the socket only,
# so a TCP check doesn't pass until the real server is up.
until "${COMPOSE[@]}" exec -T postgres-db pg_isready -q -h 127.0.0.1 2>/dev/null; do
  sleep 0.5
done
DBPORT="$("${COMPOSE[@]}" port postgres-db 5432 | head -n1 | sed 's/.*://')"
export DBPORT
echo "      Ready on port $DBPORT."

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
