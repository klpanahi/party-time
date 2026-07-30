#!/usr/bin/env bash
# Builds all deployable artifacts for party-time.
# Runs the full test suite first; exits non-zero if anything fails.
# Output: dist/ with built UIs, nginx configs, and a tagged Docker image.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
DIST="$ROOT/dist"

# Ensure postgres is stopped on exit (success or failure).
cleanup() {
  echo ""
  echo "Stopping test database..."
  docker compose -f "$ROOT/docker-compose.yml" stop postgres-db 2>/dev/null || true
}
trap cleanup EXIT

echo "=== party-time build ==="
echo ""

# ── 1. Test database ─────────────────────────────────────────────────────────
echo "[1/7] Starting test database..."
docker compose -f "$ROOT/docker-compose.yml" up -d postgres-db
until docker compose -f "$ROOT/docker-compose.yml" exec -T postgres-db pg_isready -q 2>/dev/null; do
  sleep 0.5
done
echo "      Ready."

# ── 2. Backend tests ──────────────────────────────────────────────────────────
echo "[2/7] Running backend tests..."
(cd "$ROOT/public_backend" && go test ./... -count=1)
echo "      Passed."

# ── 3. Admin UI: install, test ────────────────────────────────────────────────
echo "[3/7] Running admin UI tests..."
(cd "$ROOT/admin_ui" && npm ci --silent && npx vitest run)
echo "      Passed."

# ── 4. Invitee UI: install, test ─────────────────────────────────────────────
echo "[4/7] Running invitee UI tests..."
(cd "$ROOT/invitee_ui" && npm ci --silent && npx vitest run)
echo "      Passed."

# All tests green — stop the test DB before building.
docker compose -f "$ROOT/docker-compose.yml" stop postgres-db

# ── 5. Build admin UI ─────────────────────────────────────────────────────────
echo "[5/7] Building admin UI..."
(cd "$ROOT/admin_ui" && npm run build)

# ── 6. Build invitee UI ───────────────────────────────────────────────────────
echo "[6/7] Building invitee UI..."
(cd "$ROOT/invitee_ui" && npm run build)

# ── 7. Build backend Docker image ─────────────────────────────────────────────
echo "[7/7] Building backend Docker image (party-time-backend:latest)..."
docker compose -f "$ROOT/docker-compose.prod.yml" build --pull public-backend

# ── Bundle artifacts ──────────────────────────────────────────────────────────
echo ""
echo "Bundling artifacts..."
rm -rf "$DIST"
mkdir -p "$DIST"
cp -r "$ROOT/admin_ui/dist"            "$DIST/admin-ui"
cp -r "$ROOT/invitee_ui/dist"          "$DIST/invitee-ui"
cp    "$ROOT/deploy/nginx-public.conf" "$DIST/"
cp    "$ROOT/deploy/nginx-admin.conf"  "$DIST/"

echo ""
echo "=== Build complete ==="
echo ""
echo "Artifacts in dist/:"
echo "  admin-ui/          → scp to admin nginx VM   → /var/www/admin-ui/"
echo "  invitee-ui/        → scp to public nginx VM  → /var/www/invitee-ui/"
echo "  nginx-admin.conf   → scp to admin nginx VM   (replace BACKEND_VM_IP first)"
echo "  nginx-public.conf  → scp to public nginx VM  (replace BACKEND_VM_IP first)"
echo ""
echo "On the backend VM:"
echo "  1. Copy docker-compose.prod.yml + schema.sql"
echo "  2. Create .env.prod (see sample.local.env for required vars)"
echo "  3. docker compose -f docker-compose.prod.yml up -d"
