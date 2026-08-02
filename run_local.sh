#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

# Load local environment configuration (copy sample.local.env -> local.env).
# Variables defined there are exported into the backend below.
if [ -f "$ROOT/local.env" ]; then
  echo "Loading environment from local.env..."
  set -a
  . "$ROOT/local.env"
  set +a
else
  echo "No local.env found — using built-in defaults (cp sample.local.env local.env to customize)."
fi

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

# Wipe the database and reload fresh migrations + local test data on every startup.
# NOTE: this script is still known-broken and is being fixed separately. The
# reset below drops `public`, but the app's schema is `party_time`, so it does
# not actually reset anything; the test_data.sql load then runs without
# `search_path` set and aborts with `relation "contacts" does not exist`. Only
# the schema.sql -> goose swap happened here.
echo "Resetting database (fresh migrations + test data)..."
psql() {
  docker-compose -f "$ROOT/docker-compose.yml" exec -T postgres-db \
    psql -U myuser -d party_time -v ON_ERROR_STOP=1 "$@"
}
psql -q -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
(cd "$ROOT/public_backend" && DBHOST=127.0.0.1 go run . migrate up)
psql -q -f - < "$ROOT/test_data.sql" >/dev/null
echo "Database reset complete."

# Backend (ADMIN_ENABLED defaults to true here if local.env didn't set it)
(cd "$ROOT/public_backend" && ADMIN_ENABLED="${ADMIN_ENABLED:-true}" air .) &

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
