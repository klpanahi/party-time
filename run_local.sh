#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

RESET=1
for arg in "$@"; do
  case "$arg" in
    --no-reset)
      RESET=0
      ;;
    *)
      echo "Usage: $0 [--no-reset]" >&2
      echo "  --no-reset  skip the DB wipe/reseed and start against whatever is already there" >&2
      echo "              (use this to restart the backend without destroying state you just" >&2
      echo "              created through the UI)" >&2
      exit 1
      ;;
  esac
done

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

psql() {
  docker-compose -f "$ROOT/docker-compose.yml" exec -T postgres-db \
    psql -U myuser -d party_time -v ON_ERROR_STOP=1 "$@"
}

if [ "$RESET" -eq 1 ]; then
  # Wipe the database and reload fresh migrations + local test data on every
  # startup (unless --no-reset was passed). The app's schema is `party_time`,
  # not `public`, so that's what gets dropped; goose recreates it as part of
  # the first migration.
  echo "Resetting database (fresh migrations + test data)..."
  psql -q -c "DROP SCHEMA IF EXISTS party_time CASCADE;"
  (cd "$ROOT/public_backend" && DBHOST=127.0.0.1 go run . migrate up)
  # test_data.sql is written without schema qualification, so the loading
  # session needs search_path set to party_time. PGOPTIONS lets us do that
  # without touching test_data.sql or psql's own arg parsing (-v ON_ERROR_STOP
  # already occupies -v; PGOPTIONS is the cleanest way to inject a session-
  # level GUC into a non-interactive `psql -f -` invocation). It has to be
  # forwarded through `docker-compose exec -e` explicitly — psql runs inside
  # the postgres-db container, so setting PGOPTIONS in this (host) shell has
  # no effect on it.
  docker-compose -f "$ROOT/docker-compose.yml" exec -T -e PGOPTIONS="--search_path=party_time" \
    postgres-db psql -U myuser -d party_time -v ON_ERROR_STOP=1 -q -f - < "$ROOT/test_data.sql" >/dev/null
  echo "Database reset complete."
else
  echo "Skipping database reset (--no-reset)."
fi

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
echo "  Usage: $0 [--no-reset]"
echo "    --no-reset  skip the DB wipe/reseed (restart backend without losing UI-created state)"
echo ""
echo "Ctrl+C to stop everything."

wait
