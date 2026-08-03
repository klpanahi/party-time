#!/usr/bin/env bash
# Companion sender that drains party-time's pending-texts queue over iMessage
# instead of Twilio. macOS only (uses osascript + Messages.app).
#
# The `texts` table is a shared queue: admin actions insert 'pending' rows,
# and the backend's own worker (public_backend/worker.go) normally drains
# them through Twilio. This script is an alternative drain for local/free use
# — it claims rows via GET /admin/texts/pending (which atomically flips them
# pending -> sending, same as the Twilio worker does), sends each one through
# Messages.app, then reports the outcome back via POST /admin/texts/:id/status
# so the row lands on sent/failed instead of getting stuck or resent.
#
# IMPORTANT: do not run this against a backend that also has TWILIO_* env vars
# set and the Twilio worker running — the two drains would race for the same
# rows. Leave TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM_NUMBER unset in
# local.env when using this script.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

API="http://localhost:8080"
LIMIT=25
RATE=1
SEND=0
LOOP=0
LOOP_INTERVAL=10

usage() {
  cat <<'EOF'
Usage: ./imessage_sender.sh [options]

Drains party-time's pending texts queue and sends each one via iMessage
(Messages.app on this Mac), using the recipient's phone_number from the
contacts table.

Options:
  --send             Actually claim and send. Without this flag the script
                      only peeks at the queue (no rows are claimed) and
                      prints what it would send.
  --limit N          Max texts to pull per batch (default: 25).
  --rate SECONDS      Delay between sends (default: 1).
  --loop [SECONDS]    Keep polling every SECONDS (default: 10) instead of
                      draining once and exiting.
  --api URL           Backend base URL (default: http://localhost:8080).
  -h, --help          Show this help.

Examples:
  ./imessage_sender.sh                  # dry run, show what's pending
  ./imessage_sender.sh --send           # send everything pending, once
  ./imessage_sender.sh --send --loop    # send forever, polling every 10s
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --send)
      SEND=1
      shift
      ;;
    --limit)
      LIMIT="$2"
      shift 2
      ;;
    --rate)
      RATE="$2"
      shift 2
      ;;
    --loop)
      LOOP=1
      if [ "${2:-}" ] && [[ "${2:-}" =~ ^[0-9]+$ ]]; then
        LOOP_INTERVAL="$2"
        shift 2
      else
        shift
      fi
      ;;
    --api)
      API="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

# Load local environment configuration the same way run_local.sh does, so
# API can be overridden via local.env without editing this script.
if [ -f "$ROOT/local.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/local.env"
  set +a
  API="${API_BASE:-$API}"
fi

if [ -n "${TWILIO_ACCOUNT_SID:-}" ]; then
  echo "WARNING: TWILIO_ACCOUNT_SID is set in this environment. If the backend" >&2
  echo "you're pointed at also has Twilio configured, its worker is draining" >&2
  echo "the same queue and will race with this script for pending rows." >&2
fi

for bin in curl jq osascript; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "Missing required command: $bin" >&2
    exit 1
  fi
done

if ! curl -fsS "$API/healthz" >/dev/null 2>&1; then
  echo "Cannot reach backend at $API/healthz — is it running? (see run_local.sh)" >&2
  exit 1
fi

if [ "$SEND" -eq 1 ]; then
  if ! osascript -e 'application "Messages" is running' 2>/dev/null | grep -q true; then
    echo "Messages.app is not running — launching it..." >&2
    open -a Messages
    sleep 2
  fi
fi

# --- claimed-but-not-yet-reported tracking, for crash recovery -------------
# Any id added here without a matching report call gets reported failed on
# exit (normal or interrupted), so a crash never leaves a row stuck in
# 'sending' forever — mirrors the Twilio worker's own startup sweep.
declare -a IN_FLIGHT=()

report_status() {
  local id="$1" status="$2" error="${3:-}" sid="${4:-}"
  curl -fsS -X POST "$API/admin/texts/$id/status" \
    -H 'Content-Type: application/json' \
    -d "$(jq -n --arg status "$status" --arg error "$error" --arg sid "$sid" \
      '{status: $status, error: $error, provider_sid: $sid}')" \
    >/dev/null 2>&1 || echo "  ! failed to report status for text $id" >&2
}

cleanup() {
  if [ "${#IN_FLIGHT[@]}" -gt 0 ]; then
    echo ""
    echo "Interrupted — marking ${#IN_FLIGHT[@]} in-flight text(s) as failed so they can be resent..." >&2
    for id in "${IN_FLIGHT[@]}"; do
      report_status "$id" "failed" "interrupted (imessage_sender.sh exited before reporting)"
    done
  fi
}
trap cleanup EXIT INT TERM

# normalize_phone converts a stored phone number to something Messages.app's
# "participant" lookup accepts: E.164, defaulting to +1 for bare 10-digit US
# numbers (this app's numbers are US-only per the seed data / Twilio setup).
normalize_phone() {
  local raw="$1"
  local digits
  digits="$(echo "$raw" | tr -dc '0-9+')"
  case "$digits" in
    +*) echo "$digits" ;;
    1??????????) echo "+$digits" ;;
    ??????????) echo "+1$digits" ;;
    *) echo "$digits" ;; # not 10/11 digits — pass through, let Messages reject it
  esac
}

send_via_imessage() {
  local phone="$1" body="$2"
  # The leading "-" tells osascript to read the script from stdin; without it,
  # osascript treats the first positional argument after the heredoc as a
  # script *filename* and fails with "No such file or directory".
  osascript - "$phone" "$body" <<'APPLESCRIPT'
on run argv
  set thePhone to item 1 of argv
  set theBody to item 2 of argv
  tell application "Messages"
    set targetService to 1st service whose service type = iMessage
    set targetBuddy to participant thePhone of targetService
    send theBody to targetBuddy
  end tell
end run
APPLESCRIPT
}

drain_once() {
  local mode="peek=true"
  [ "$SEND" -eq 1 ] && mode="" # claim for real when sending

  local url="$API/admin/texts/pending?limit=$LIMIT"
  [ -n "$mode" ] && url="$url&$mode"

  local resp
  if ! resp="$(curl -fsS "$url")"; then
    echo "Failed to fetch pending texts from $url" >&2
    return 1
  fi

  local count
  count="$(echo "$resp" | jq 'length')"
  if [ "$count" -eq 0 ]; then
    echo "No pending texts."
    return 0
  fi

  if [ "$SEND" -eq 0 ]; then
    echo "DRY RUN — $count pending text(s) (pass --send to actually deliver):"
    echo "$resp" | jq -r '.[] | "  #\(.id)  \(.first_name) \(.last_name) <\(.phone_number)>  \(.content | split("\n")[0] | .[0:60])"'
    return 0
  fi

  echo "Claimed $count text(s). Sending..."
  # Process substitution (not a pipe) so the loop runs in *this* shell, not a
  # subshell — otherwise updates to IN_FLIGHT would be invisible to the
  # cleanup trap registered on the main shell.
  while IFS= read -r row; do
    local id first last phone content
    id="$(echo "$row" | jq -r '.id')"
    first="$(echo "$row" | jq -r '.first_name')"
    last="$(echo "$row" | jq -r '.last_name')"
    phone="$(echo "$row" | jq -r '.phone_number')"
    content="$(echo "$row" | jq -r '.content')"

    IN_FLIGHT+=("$id")
    local normalized
    normalized="$(normalize_phone "$phone")"

    echo "  -> #$id to $first $last ($normalized)"
    local err=""
    if err="$(send_via_imessage "$normalized" "$content" 2>&1 >/dev/null)"; then
      report_status "$id" "sent" "" "imessage"
      echo "     sent"
    else
      report_status "$id" "failed" "$err"
      echo "     FAILED: $err" >&2
    fi

    # Remove id from in-flight tracking now that it's been reported. Built as
    # a fresh array (rather than reassigning in place) to dodge a bash 3.2
    # quirk where expanding an empty array under `set -u` errors.
    local remaining=()
    for x in "${IN_FLIGHT[@]}"; do
      [ "$x" != "$id" ] && remaining+=("$x")
    done
    if [ "${#remaining[@]}" -gt 0 ]; then
      IN_FLIGHT=("${remaining[@]}")
    else
      IN_FLIGHT=()
    fi

    sleep "$RATE"
  done < <(echo "$resp" | jq -c '.[]')
}

if [ "$LOOP" -eq 1 ]; then
  echo "Polling every ${LOOP_INTERVAL}s (Ctrl-C to stop)..."
  while true; do
    drain_once
    sleep "$LOOP_INTERVAL"
  done
else
  drain_once
fi
