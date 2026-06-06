#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

cleanup() {
  echo ""
  echo "Shutting down..."
  kill $(jobs -p) 2>/dev/null || true
  docker-compose -f "$ROOT/public_backend/docker-compose.yml" stop
}
trap cleanup EXIT INT TERM

# Database
echo "Starting database..."
docker-compose -f "$ROOT/public_backend/docker-compose.yml" up -d

echo "Waiting for postgres..."
until docker-compose -f "$ROOT/public_backend/docker-compose.yml" exec -T postgres-db pg_isready -q 2>/dev/null; do
  sleep 0.5
done

# Backend
(cd "$ROOT/public_backend" && ADMIN_ENABLED=true air .) &

# UIs
(cd "$ROOT/admin_ui"   && npm run dev) &
(cd "$ROOT/invitee_ui" && npm run dev) &

echo ""
echo "  Backend    → http://localhost:8080"
echo "  Admin UI   → http://localhost:5173"
echo "  Invitee UI → http://localhost:5174"
echo ""
echo "Ctrl+C to stop everything."

wait
