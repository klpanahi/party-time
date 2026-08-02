#!/usr/bin/env bash
# Builds all deployable artifacts for party-time.
# Runs the full test suite first; exits non-zero if anything fails.
# Output: dist/ with built UIs, nginx configs, and a tagged Docker image.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
DIST="$ROOT/dist"

echo "=== party-time build ==="
echo ""

# ── 1. Test suite (backend + both UIs) ────────────────────────────────────────
# test.sh owns the test-database lifecycle (start before, stop after) itself,
# so there is nothing left for build.sh to start or clean up here.
echo "[1/4] Running test suite..."
"$ROOT/test.sh"
echo "      Passed."

# ── 2. Build admin UI ─────────────────────────────────────────────────────────
echo "[2/4] Building admin UI..."
(cd "$ROOT/admin_ui" && npm run build)

# ── 3. Build invitee UI ───────────────────────────────────────────────────────
echo "[3/4] Building invitee UI..."
(cd "$ROOT/invitee_ui" && npm run build)

# ── 4. Cross-build backend image for the VMs ─────────────────────────────────
# The VMs are amd64 and this machine is likely arm64. Building here and shipping
# the result replaces an in-guest compile that took minutes on a 2 vCPU / 2 GB /
# no-swap VM competing with Postgres.
echo "[4/4] Cross-building backend image for linux/amd64..."
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
# The nginx vhost bodies are NOT bundled here. deploy/nginx/{public,admin}.conf
# are read directly from the repo by the playbook (lookup('file', ...)) and
# mounted straight into the local edge stack, so there is exactly one copy and
# nothing to keep in sync.

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
echo ""
echo "Deploy with:"
echo "  cd $ROOT"
echo "  ANSIBLE_CONFIG=~/Documents/Workspace/homelab/ansible/ansible.cfg \\"
echo "    ansible-playbook deploy/party-time.yml -e party_time_repo=$ROOT"
