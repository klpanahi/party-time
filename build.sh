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

# ── 7. Cross-build backend image for the VMs ─────────────────────────────────
# The VMs are amd64 and this machine is likely arm64. Building here and shipping
# the result replaces an in-guest compile that took minutes on a 2 vCPU / 2 GB /
# no-swap VM competing with Postgres.
echo "[7/7] Cross-building backend image for linux/amd64..."
docker buildx build \
  --platform linux/amd64 \
  --pull \
  --tag party-time-backend:latest \
  --load \
  "$ROOT/public_backend"

# Guard against silently shipping an image the VMs cannot execute.
image_arch="$(docker image inspect party-time-backend:latest --format '{{.Architecture}}')"
if [ "$image_arch" != "amd64" ]; then
  echo "      ERROR: built image is '$image_arch', expected 'amd64'." >&2
  echo "      The VMs cannot run this. Refusing to continue." >&2
  exit 1
fi
echo "      Built linux/amd64."

# ── Bundle artifacts ──────────────────────────────────────────────────────────
echo ""
echo "Bundling artifacts..."
rm -rf "$DIST"
mkdir -p "$DIST"
cp -r "$ROOT/admin_ui/dist"            "$DIST/admin-ui"
cp -r "$ROOT/invitee_ui/dist"          "$DIST/invitee-ui"
cp    "$ROOT/deploy/nginx-public.conf" "$DIST/"
cp    "$ROOT/deploy/nginx-admin.conf"  "$DIST/"

# The deploy playbook ships this tarball and docker-loads it on the VM, so the
# VM never compiles anything. gzip because it crosses the network.
echo "Exporting backend image..."
docker save party-time-backend:latest | gzip > "$DIST/party-time-backend-amd64.tar.gz"

echo ""
echo "=== Build complete ==="
echo ""
echo "Artifacts in dist/:"
echo "  admin-ui/                        built admin UI    → /var/www/admin-ui/"
echo "  invitee-ui/                      built invitee UI  → /var/www/invitee-ui/"
echo "  party-time-backend-amd64.tar.gz  linux/amd64 image → docker load on the VM"
echo "  nginx-admin.conf, nginx-public.conf  (legacy; the live configs are"
echo "                                        Ansible group_vars in the homelab repo)"
echo ""
echo "Deploy with:"
echo "  cd ~/Documents/Workspace/homelab/ansible"
echo "  ansible-playbook ../deploy/party-time.yml -e party_time_repo=$ROOT"
