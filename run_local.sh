#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

cleanup() {
  echo ""
  echo "Shutting down..."
  kill $(jobs -p) 2>/dev/null || true
  docker-compose -f "$ROOT/docker-compose.yml" stop
}
trap cleanup EXIT INT TERM

# Database
echo "Starting database..."
docker-compose -f "$ROOT/docker-compose.yml" up -d

echo "Waiting for postgres..."
until docker-compose -f "$ROOT/docker-compose.yml" exec -T postgres-db pg_isready -q 2>/dev/null; do
  sleep 0.5
done

# Wipe the database and reload a fresh schema + local test data on every startup.
echo "Resetting database (fresh schema + test data)..."
psql() {
  docker-compose -f "$ROOT/docker-compose.yml" exec -T postgres-db \
    psql -U myuser -d party_time -v ON_ERROR_STOP=1 "$@"
}
psql -q -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
psql -q -f - < "$ROOT/schema.sql" >/dev/null
psql -q -f - < "$ROOT/test_data.sql" >/dev/null
echo "Database reset complete."

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
