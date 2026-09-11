#!/usr/bin/env bash
# Companion sender that drains party-time's pending-texts queue through
# Messages.app instead of Twilio. macOS only (uses osascript).
#
# The `texts` table is a shared queue: admin actions insert 'pending' rows,
# and the backend's own worker (public_backend/worker.go) normally drains
# them through Twilio. This script is an alternative drain for local/free use
# — it claims rows via GET /admin/texts/pending (which atomically flips them
# pending -> sending, same as the Twilio worker does), sends each one through
# Messages.app, then reports the outcome back via POST /admin/texts/:id/status
# so the row lands on sent/failed instead of getting stuck or resent.
#
# The channel is not discovered here — it comes from the recipient. Each
# contact carries a message_type of "imessage" or "sms", which the claim
# endpoint returns alongside the body, and this script sends over exactly that
# service. One attempt, one outcome: if `send` errors the row is reported
# failed, and there is no fallback, retry, or delivery verification.
#
# SMS contacts require Text Message Forwarding to be enabled from a paired
# iPhone (iPhone: Settings > Messages > Text Message Forwarding). Without it
# this Mac has no SMS service and those texts are reported failed.
#
# One failure mode is invisible from here: Messages can accept a send and then
# fail to deliver it seconds later (the red "Not Delivered" badge). Its
# scripting dictionary defines no `message` class and `send` declares no
# result, so nothing in AppleScript can see that. Such a text is recorded as
# 'sent'. The fix is manual and deliberate: switch that contact to SMS on the
# admin Contacts page, then use the admin status override to put the text back
# to 'pending' — the next drain picks it up and sends it over SMS.
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
# Set per-text by drain_once; send_through_service appends osascript's stderr
# here so it can be reported as the row's error without swallowing our own
# progress output.
ERR_FILE=""

usage() {
  cat <<'EOF'
Usage: ./imessage_sender.sh [options]

Drains party-time's pending texts queue through Messages.app on this Mac,
sending each text over the channel recorded on the recipient's contact —
iMessage or SMS. Set that on the Contacts page in the admin UI. SMS needs
Text Message Forwarding enabled from a paired iPhone.

Options:
  --send             Actually claim and send. Without this flag the script
                      only peeks at the queue (no rows are claimed) and
                      prints what it would send, and over which channel.
  --limit N          Max texts to pull per batch (default: 25).
  --rate SECONDS      Delay between sends (default: 1).
  --loop [SECONDS]    Keep polling every SECONDS (default: 10) instead of
                      draining once and exiting.
  --api URL           Backend base URL (default: http://localhost:8080).
  -h, --help          Show this help.

Run without --send first to check the channel each pending text will use.

Examples:
  ./imessage_sender.sh                  # dry run, show what's pending
  ./imessage_sender.sh --send           # send everything pending, once
  ./imessage_sender.sh --send --loop    # send forever, polling every 10s
EOF
}

# Options are validated up front rather than left to fail later. A bad
# --limit/--rate used to surface only once osascript or sleep choked on it,
# by which point drain_once had already claimed rows into 'sending' — so a
# typo burned a whole batch to 'failed' instead of just rejecting the flag.
# Note the "${2:-}" reads: under `set -u`, a bare "$2" on a trailing flag
# aborts with "unbound variable" before we can print anything useful.
require_value() {
  if [ -z "${2:-}" ]; then
    echo "Option $1 requires a value." >&2
    exit 1
  fi
}

require_number() {
  require_value "$1" "${2:-}"
  if ! [[ "$2" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
    echo "Option $1 expects a non-negative number, got: $2" >&2
    exit 1
  fi
}

while [ $# -gt 0 ]; do
  case "$1" in
    --send)
      SEND=1
      shift
      ;;
    --limit)
      require_number "$1" "${2:-}"
      LIMIT="$2"
      shift 2
      ;;
    --rate)
      require_number "$1" "${2:-}"
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
      require_value "$1" "${2:-}"
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

# send_through_service pushes one message out over exactly one service —
# "imessage" or "sms", taken from the recipient's contact — and fails if that
# service isn't available or `send` errors. There is no second attempt: a
# failure is reported as such and the admin decides what to do about it.
#
# `send` is the last statement, so any error means the message did not go
# out. Nothing here can double-send.
send_through_service() {
  local phone="$1" body="$2" channel="$3"
  # osascript's stderr goes to ERR_FILE (set per-text by drain_once) rather
  # than the caller redirecting this function wholesale — otherwise the
  # script's own progress output would be captured into a file that's only
  # printed on failure and would never be seen.
  #
  # The leading "-" tells osascript to read the script from stdin; without it,
  # osascript treats the first positional argument after the heredoc as a
  # script *filename* and fails with "No such file or directory".
  osascript - "$phone" "$body" "$channel" 2>>"${ERR_FILE:-/dev/stderr}" <<'APPLESCRIPT'
on run argv
  set thePhone to item 1 of argv
  set theBody to item 2 of argv
  set wantSMS to (item 3 of argv is "sms")
  tell application "Messages"
    -- `service type = SMS` only matches when this Mac has Text Message
    -- Forwarding turned on from a paired iPhone (iPhone: Settings >
    -- Messages > Text Message Forwarding). Without it the lookup below
    -- errors, which is the caller's signal that there's no SMS route.
    if wantSMS then
      set targetService to 1st service whose service type = SMS
    else
      set targetService to 1st service whose service type = iMessage
    end if
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
    echo "$resp" | jq -r '.[] | "  #\(.id)  [\(.message_type // "imessage")]  \(.first_name) \(.last_name) <\(.phone_number)>  \(.content | split("\n")[0] | .[0:60])"'
    return 0
  fi

  echo "Claimed $count text(s). Sending..."
  # Process substitution (not a pipe) so the loop runs in *this* shell, not a
  # subshell — otherwise updates to IN_FLIGHT would be invisible to the
  # cleanup trap registered on the main shell.
  while IFS= read -r row; do
    local id first last phone content channel
    id="$(echo "$row" | jq -r '.id')"
    first="$(echo "$row" | jq -r '.first_name')"
    last="$(echo "$row" | jq -r '.last_name')"
    phone="$(echo "$row" | jq -r '.phone_number')"
    content="$(echo "$row" | jq -r '.content')"
    # `// "imessage"` covers a backend that predates contacts carrying a
    # message_type, so an older deployment still sends rather than erroring.
    channel="$(echo "$row" | jq -r '.message_type // "imessage"')"

    IN_FLIGHT+=("$id")
    local normalized
    normalized="$(normalize_phone "$phone")"

    echo "  -> #$id to $first $last ($normalized) via $channel"
    ERR_FILE="$(mktemp)"
    local err_file="$ERR_FILE"
    if send_through_service "$normalized" "$content" "$channel"; then
      report_status "$id" "sent" "" "$channel"
      echo "     sent"
    else
      local err
      err="$(cat "$err_file")"
      report_status "$id" "failed" "$err"
      echo "     FAILED: $err" >&2
    fi
    rm -f "$err_file"

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
