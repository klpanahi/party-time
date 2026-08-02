#!/usr/bin/env bash
# End-to-end smoke test against a prod-shaped local edge: real nginx (running
# the exact deploy/nginx/{public,admin}.conf vhost bodies), a real backend
# process, and a seeded Postgres — reached only through nginx, the way a
# browser or Cloudflare would. Exits non-zero on any assertion failure.
#
# What this proves that the unit/integration test suite (test.sh) cannot:
# that a route registered in the Go router is actually reachable through the
# nginx vhost, and that the Accept-split / Cache-Control behaviour documented
# in deploy/nginx/public.conf hasn't regressed. A route that works against
# `go test` or a direct `curl localhost:8080` can still be invisible in
# production if the nginx regex doesn't match it — the symptom is nginx
# quietly serving the SPA's index.html instead of the API response, which
# looks like a JSON parse error in the browser, not a 404.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
COMPOSE="docker-compose -f $ROOT/docker-compose.yml"
EDGE="docker compose -f $ROOT/docker-compose.local-edge.yml"
PUBLIC_BASE="http://localhost:8090"
ADMIN_BASE="http://localhost:8091"

FAILURES=0
fail() {
  echo "FAIL: $*" >&2
  FAILURES=$((FAILURES + 1))
}
pass() {
  echo "PASS: $*"
}

BACKEND_PID=""
cleanup() {
  echo ""
  echo "Tearing down..."
  if [ -n "$BACKEND_PID" ]; then
    kill "$BACKEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
  fi
  $EDGE down 2>/dev/null || true
  $COMPOSE stop 2>/dev/null || true
}
trap cleanup EXIT

# ── 1. Built UIs ───────────────────────────────────────────────────────────
# The nginx edge serves these directories as static roots, same as production.
# We require them built rather than building unconditionally on every e2e
# run — a full `npm run build` of both UIs adds real time to a smoke test
# that's meant to run often, and build.sh/test.sh already exercise the build
# step itself. If dist/ is missing (first run, or after a clean), build it
# once here so e2e.sh is still runnable standalone.
if [ ! -d "$ROOT/invitee_ui/dist" ]; then
  echo "invitee_ui/dist missing — building..."
  (cd "$ROOT/invitee_ui" && npm run build)
fi
if [ ! -d "$ROOT/admin_ui/dist" ]; then
  echo "admin_ui/dist missing — building..."
  (cd "$ROOT/admin_ui" && npm run build)
fi

# ── 2. Fresh seeded database ──────────────────────────────────────────────
echo "Starting database..."
$COMPOSE up -d
until $COMPOSE exec -T postgres-db pg_isready -q 2>/dev/null; do
  sleep 0.5
done

psql() {
  $COMPOSE exec -T postgres-db psql -U myuser -d party_time -v ON_ERROR_STOP=1 "$@"
}

echo "Resetting database (fresh migrations + test data)..."
psql -q -c "DROP SCHEMA IF EXISTS party_time CASCADE;"
(cd "$ROOT/public_backend" && DBHOST=127.0.0.1 go run . migrate up)
$COMPOSE exec -T -e PGOPTIONS="--search_path=party_time" postgres-db \
  psql -U myuser -d party_time -v ON_ERROR_STOP=1 -q -f - < "$ROOT/test_data.sql" >/dev/null

# ── 3. Backend, running on the host like run_local.sh's does ──────────────
echo "Starting backend..."
(cd "$ROOT/public_backend" && DBHOST=127.0.0.1 ADMIN_ENABLED=true INVITEE_BASE_URL=http://localhost:8090 go run . >/tmp/party-time-e2e-backend.log 2>&1) &
BACKEND_PID=$!

echo "Waiting for backend on :8080..."
for _ in $(seq 1 60); do
  if curl -fs http://localhost:8080/invites >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ! curl -fs http://localhost:8080/invites >/dev/null 2>&1; then
  echo "Backend never became ready. Log:" >&2
  cat /tmp/party-time-e2e-backend.log >&2
  exit 1
fi

# ── 4. Prod-shaped nginx edge ───────────────────────────────────────────────
echo "Starting local edge (nginx)..."
$EDGE up -d
echo "Waiting for nginx on :8090/:8091..."
for _ in $(seq 1 30); do
  if curl -fs "$PUBLIC_BASE/" >/dev/null 2>&1 && curl -fs "$ADMIN_BASE/" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# ── 5. Real seeded IDs to exercise ─────────────────────────────────────────
INVITE_ID="$(psql -t -A -q -c "SET search_path TO party_time; SELECT id FROM invites LIMIT 1;" | tr -d '[:space:]')"
EVENT_ID="$(psql -t -A -q -c "SET search_path TO party_time; SELECT id FROM events LIMIT 1;" | tr -d '[:space:]')"
if [ -z "$INVITE_ID" ] || [ -z "$EVENT_ID" ]; then
  echo "Could not obtain seeded invite/event IDs from the database." >&2
  exit 1
fi
echo "Using invite id=$INVITE_ID event id=$EVENT_ID"

is_spa_html() {
  # SPA index.html always starts with a doctype declaration; API JSON never does.
  head -c 100 "$1" | tr '[:upper:]' '[:lower:]' | grep -q '<!doctype html'
}

check_html_json_split() {
  local label="$1" path="$2"
  local html_out json_out headers_html headers_json

  html_out="$(mktemp)"; headers_html="$(mktemp)"
  json_out="$(mktemp)"; headers_json="$(mktemp)"

  curl -s -D "$headers_html" -H "Accept: text/html" "$PUBLIC_BASE$path" -o "$html_out"
  if is_spa_html "$html_out"; then
    pass "$label (text/html) → SPA HTML"
  else
    fail "$label (text/html) did not return SPA index.html"
  fi
  if grep -qi '^Cache-Control:.*no-store' "$headers_html"; then
    pass "$label (text/html) → Cache-Control: no-store"
  else
    fail "$label (text/html) missing Cache-Control: no-store"
  fi

  curl -s -D "$headers_json" -H "Accept: application/json" "$PUBLIC_BASE$path" -o "$json_out"
  if is_spa_html "$json_out"; then
    fail "$label (application/json) returned SPA HTML instead of JSON"
  else
    pass "$label (application/json) → JSON"
  fi
  if grep -qi '^Cache-Control:.*no-store' "$headers_json"; then
    pass "$label (application/json) → Cache-Control: no-store"
  else
    fail "$label (application/json) missing Cache-Control: no-store"
  fi

  rm -f "$html_out" "$json_out" "$headers_html" "$headers_json"
}

# ── 6. Assertions 1-3: Accept-split + Cache-Control on /invite and /event ──
check_html_json_split "GET /invite/:id" "/invite/$INVITE_ID"
check_html_json_split "GET /event/:id" "/event/$EVENT_ID"

# ── 7. Assertion 4: admin edge ─────────────────────────────────────────────
admin_root_out="$(mktemp)"
curl -s "$ADMIN_BASE/" -o "$admin_root_out"
if is_spa_html "$admin_root_out"; then
  pass "GET / (admin edge) → 200 HTML"
else
  fail "GET / (admin edge) did not return HTML"
fi
rm -f "$admin_root_out"

admin_events_code="$(curl -s -o /tmp/party-time-e2e-admin-events.json -w '%{http_code}' "$ADMIN_BASE/admin/events")"
if [ "$admin_events_code" = "200" ] && ! is_spa_html /tmp/party-time-e2e-admin-events.json; then
  pass "GET /admin/events → JSON"
else
  fail "GET /admin/events did not return JSON (http $admin_events_code)"
fi

# ── 8. Assertion 5: every registered public route is reachable ────────────
# Parsed from public_backend/main.go rather than hardcoded, so a route added
# tomorrow is covered automatically. Only router.<METHOD>(...) calls count —
# admin.<METHOD>(...) registrations are under /admin and are out of scope for
# the public edge (the public vhost never proxies them; that's intentional).
echo ""
echo "Discovering registered public routes from main.go..."
# BSD sed (macOS default) doesn't support \s in -E mode, so avoid it: grep
# out just the "METHOD("path"" fragment, then split on '("' with sed.
ROUTES="$(grep -E '^[[:space:]]*router\.(GET|POST|PUT|DELETE|PATCH)\(' "$ROOT/public_backend/main.go" \
  | grep -oE '(GET|POST|PUT|DELETE|PATCH)\("[^"]+"' \
  | sed -E 's/\("/ /; s/"$//')"

if [ -z "$ROUTES" ]; then
  echo "No public routes discovered — parsing regex may be stale against main.go." >&2
  exit 1
fi

while IFS=' ' read -r method path; do
  [ -z "$method" ] && continue
  resolved_path="${path//:id/$INVITE_ID}"
  # /event/:id uses the event id, not the invite id.
  case "$path" in
    /event/*) resolved_path="${path//:id/$EVENT_ID}" ;;
  esac

  out="$(mktemp)"
  case "$method" in
    PUT)
      code="$(curl -s -o "$out" -w '%{http_code}' -X PUT \
        -H "Accept: application/json" -H "Content-Type: application/json" \
        -d '{"rsvp_status":"Tentative","additional_guests":0}' \
        "$PUBLIC_BASE$resolved_path")"
      ;;
    *)
      code="$(curl -s -o "$out" -w '%{http_code}' -H "Accept: application/json" "$PUBLIC_BASE$resolved_path")"
      ;;
  esac

  if is_spa_html "$out"; then
    fail "$method $path (edge: $resolved_path) → SPA HTML instead of the API (http $code) — nginx regex doesn't match this route"
  else
    pass "$method $path (edge: $resolved_path) reachable through the public edge (http $code)"
  fi
  rm -f "$out"
done <<< "$ROUTES"

echo ""
if [ "$FAILURES" -gt 0 ]; then
  echo "=== e2e FAILED: $FAILURES assertion(s) failed ==="
  exit 1
fi
echo "=== e2e passed ==="
