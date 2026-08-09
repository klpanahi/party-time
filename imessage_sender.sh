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
# Recipients who can't receive iMessage (e.g. Android) are automatically
# retried over SMS, the same fallback Messages.app's own "Send as Text
# Message" button uses. That requires Text Message Forwarding to be enabled
# from a paired iPhone (iPhone: Settings > Messages > Text Message
# Forwarding) — without it there's no SMS service on this Mac and those
# texts are simply reported failed for manual resend.
#
# Two different iMessage failures have to be caught, and only one of them is
# visible to AppleScript:
#
#   1. Messages refuses the send outright, because it already knows the
#      handle isn't iMessage-capable. `send` errors and we retry over SMS.
#   2. Messages ACCEPTS the send and delivery fails a moment later over the
#      network. `send` returns clean; the message turns into a red "Not
#      Delivered" in the UI seconds afterwards.
#
# Case 2 cannot be seen from AppleScript at all: Messages.app's scripting
# dictionary defines no `message` class (only participant, account, chat,
# file transfer) and its `send` command declares no result, so there is no
# sent-message object to inspect. An earlier attempt to read an `error`
# property off one shipped broken — `error` is a reserved AppleScript
# keyword, so it failed to *compile* and took the whole script down.
#
# So case 2 is detected against Messages' own SQLite store instead
# (~/Library/Messages/chat.db, read-only), which carries the error code
# behind that "Not Delivered" badge. That needs Full Disk Access on whatever
# runs this script; without it the check is skipped and the script says so
# loudly on every run rather than quietly reporting failures as sent.
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
VERIFY=1
DELIVERY_WAIT=8
# Set per-text by drain_once; send_through_service appends osascript's stderr
# here so it can be reported as the row's error without swallowing our own
# progress output.
ERR_FILE=""

usage() {
  cat <<'EOF'
Usage: ./imessage_sender.sh [options]

Drains party-time's pending texts queue and sends each one via iMessage
(Messages.app on this Mac), using the recipient's phone_number from the
contacts table. Recipients who can't receive iMessage (e.g. Android) are
retried automatically over SMS if this Mac has Text Message Forwarding
enabled from a paired iPhone.

Options:
  --send             Actually claim and send. Without this flag the script
                      only peeks at the queue (no rows are claimed) and
                      prints what it would send.
  --limit N          Max texts to pull per batch (default: 25).
  --rate SECONDS      Delay between sends (default: 1).
  --delivery-wait N   Seconds to watch for a delivery failure after each
                      iMessage before accepting it as sent (default: 8).
                      Raise it on a slow connection.
  --no-verify         Skip the chat.db delivery check entirely and trust
                      whatever Messages reports immediately.
  --loop [SECONDS]    Keep polling every SECONDS (default: 10) instead of
                      draining once and exiting.
  --api URL           Backend base URL (default: http://localhost:8080).
  -h, --help          Show this help.

The dry run also reports whether delivery verification is working, so you
can confirm Full Disk Access is granted before committing to a real --send.

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

# Whole seconds only — this one feeds shell arithmetic for the poll deadline,
# which can't handle a decimal.
require_int() {
  require_value "$1" "${2:-}"
  if ! [[ "$2" =~ ^[0-9]+$ ]]; then
    echo "Option $1 expects a whole number of seconds, got: $2" >&2
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
    --delivery-wait)
      require_int "$1" "${2:-}"
      DELIVERY_WAIT="$2"
      shift 2
      ;;
    --no-verify)
      VERIFY=0
      shift
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
# "imessage" or "sms" — and fails if that service isn't available or `send`
# errors. It deliberately does NOT decide anything about retries; choosing
# the channel is deliver_text's job below, in bash, where the logic is
# readable and testable rather than buried in an AppleScript error handler.
#
# `send` is the last statement, so any error means the message did not go
# out. Nothing here can double-send.
send_through_service() {
  local phone="$1" body="$2" channel="$3"
  # osascript's stderr goes to ERR_FILE (set per-text by drain_once) rather
  # than the caller redirecting deliver_text wholesale — otherwise this
  # script's own warnings, including "verification is OFF", would be captured
  # into a file that's only printed on failure and would never be seen.
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

# --- delivery verification via chat.db --------------------------------------
# Messages.app's AppleScript interface cannot tell us whether a message
# actually landed (see the header comment). Its SQLite store can: every
# message row carries an `error` code that Messages sets when delivery fails,
# which is the same signal behind the red "Not Delivered" badge in the UI.
#
# This is read-only and needs Full Disk Access on whatever runs this script.
# When it isn't available we fall back to trusting `send` — but loudly, and
# only after saying so up front, because the whole point of this machinery is
# that a silent "everything's fine" is exactly the failure mode being killed.

CHAT_DB="$HOME/Library/Messages/chat.db"
VERIFY_OK=0

chat_db_query() {
  # -readonly so we can never write to the user's message store. Errors are
  # swallowed here; probe_verification is what reports them, once, up front.
  sqlite3 -readonly "file:$CHAT_DB?mode=ro" "$1" 2>/dev/null
}

# probe_verification decides once, at startup, whether the delivery check can
# work, and sets VERIFY_OK. It runs in dry-run mode too — the whole point is
# to surface a Full Disk Access or schema problem BEFORE a --send run claims
# rows and discovers mid-batch that it can't verify anything.
#
# The probe is a real query, not a [ -r ] test: under TCC the file stats
# fine and fails at open(), so only actually opening it proves anything.
# LIMIT 0 makes SQLite resolve every table and column we depend on without
# returning a single row of message data.
probe_verification() {
  local out
  if [ "$VERIFY" -eq 0 ]; then
    echo "Delivery verification: OFF (--no-verify). Silent iMessage failures"
    echo "  will be recorded as 'sent'."
    return
  fi

  if ! command -v sqlite3 >/dev/null 2>&1; then
    echo "Delivery verification: OFF — sqlite3 not found on PATH." >&2
    return
  fi

  # Must be an `if` condition, not a bare assignment: under `set -e` a failing
  # command substitution in an assignment kills the script outright, so the
  # error branch below would never be reached on the very failure it exists
  # to report.
  if out="$(sqlite3 -readonly "file:$CHAT_DB?mode=ro" \
    'SELECT m.ROWID, m.error, m.is_from_me, m.handle_id, h.id
     FROM message m JOIN handle h ON m.handle_id = h.ROWID LIMIT 0;' 2>&1)"; then
    VERIFY_OK=1
    echo "Delivery verification: ON (chat.db readable, watching ${DELIVERY_WAIT}s per send)."
    return
  fi

  echo "Delivery verification: OFF — cannot query $CHAT_DB" >&2
  echo "  sqlite3: $out" >&2
  case "$out" in
    *"authorization denied"*|*"unable to open database"*|*"not authorized"*)
      # Don't assume TCC: the same sqlite3 error covers a genuinely absent
      # file. Note that a stat failure isn't proof of absence either — macOS
      # hides protected paths from processes it hasn't granted, so an
      # unreadable chat.db can look exactly like a missing one.
      if [ -e "$CHAT_DB" ]; then
        echo "  The file is there but can't be opened, which is macOS Full Disk" >&2
        echo "  Access. Grant it to the terminal running this script: System" >&2
        echo "  Settings > Privacy & Security > Full Disk Access, then restart" >&2
        echo "  that terminal." >&2
      else
        echo "  Nothing visible at that path. Either Messages has never run on" >&2
        echo "  this Mac, or macOS is hiding the file from this process — which" >&2
        echo "  is what a Full Disk Access denial looks like. Grant it under" >&2
        echo "  System Settings > Privacy & Security > Full Disk Access and" >&2
        echo "  restart the terminal; if the path is still missing after that," >&2
        echo "  it genuinely isn't there." >&2
      fi
      ;;
    *"no such table"*|*"no such column"*)
      echo "  chat.db exists but its schema isn't what this script expects —" >&2
      echo "  Apple changed it. The query in imessage_failed needs updating." >&2
      ;;
  esac
  echo "  Sends will still work and immediate failures still fall back to SMS," >&2
  echo "  but a silent iMessage failure will be recorded as 'sent'." >&2
  echo "  Pass --no-verify to accept that and silence this." >&2
}

# Baseline taken immediately BEFORE sending, so we can find the row we just
# created without matching on message text — `text` is NULL on modern macOS
# for many rows (the body lives in attributedBody as encoded data instead).
chat_db_baseline() {
  chat_db_query 'SELECT COALESCE(MAX(ROWID), 0) FROM message;'
}

# imessage_failed polls for our new outgoing row and reports whether Messages
# flagged it. Returns 0 (shell-true) ONLY on a definite failure — an unknown
# or still-pending result is deliberately not treated as failure, so we never
# double-send on a slow-but-fine delivery.
imessage_failed() {
  # $phone is interpolated into SQL, which is only safe because it comes from
  # normalize_phone, which strips everything outside [0-9+] — there is no way
  # for a quote to survive that. Keep it that way if normalize_phone changes.
  local baseline="$1" phone="$2" deadline err
  deadline=$(( $(date +%s) + DELIVERY_WAIT ))
  while :; do
    # `|| true` inside the substitution: without it, a transient sqlite3
    # failure would trip `set -e` and kill the run with rows still claimed.
    err="$(chat_db_query "
      SELECT COALESCE(m.error, 0)
      FROM message m
      JOIN handle h ON m.handle_id = h.ROWID
      WHERE m.ROWID > $baseline AND m.is_from_me = 1 AND h.id = '$phone'
      ORDER BY m.ROWID DESC LIMIT 1;" || true)"
    [ -n "$err" ] && [ "$err" != "0" ] && return 0
    [ "$(date +%s)" -ge "$deadline" ] && return 1
    sleep 1
  done
}

# deliver_text owns the channel decision: iMessage first, SMS when iMessage
# either refuses up front or is verified to have failed. Prints the channel
# that actually carried the message ("imessage" or "sms") on stdout.
deliver_text() {
  local phone="$1" body="$2"
  local baseline="" verify=0

  # VERIFY_OK was settled by probe_verification at startup, so a permissions
  # or schema problem has already been reported once rather than per text.
  if [ "$VERIFY_OK" -eq 1 ]; then
    verify=1
    baseline="$(chat_db_baseline || true)"
    # No baseline means no safe way to identify our row; skip the check for
    # this text rather than risk matching someone else's message.
    [ -z "$baseline" ] && verify=0
  fi

  if send_through_service "$phone" "$body" "imessage"; then
    if [ "$verify" -eq 1 ] && imessage_failed "$baseline" "$phone"; then
      # iMessage accepted the send and then failed to deliver. The dead
      # message stays in the thread as "Not Delivered" — that's Messages'
      # own UI and we can't retract it — but the guest still gets the text.
      echo "     iMessage reported not delivered — retrying over SMS" >&2
      send_through_service "$phone" "$body" "sms" || return 1
      echo "sms"
      return 0
    fi
    echo "imessage"
    return 0
  fi

  # iMessage refused up front (the common Android case: Messages already
  # knows the handle isn't iMessage-capable). Nothing was sent, so an SMS
  # retry here cannot duplicate anything.
  send_through_service "$phone" "$body" "sms" || return 1
  echo "sms"
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
    local via
    ERR_FILE="$(mktemp)"
    local err_file="$ERR_FILE"
    if via="$(deliver_text "$normalized" "$content")"; then
      report_status "$id" "sent" "" "$via"
      echo "     sent via $via"
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

# Runs in dry-run mode too, so `./imessage_sender.sh` on its own tells you
# whether a real --send would be able to verify deliveries.
probe_verification
echo ""

if [ "$LOOP" -eq 1 ]; then
  echo "Polling every ${LOOP_INTERVAL}s (Ctrl-C to stop)..."
  while true; do
    drain_once
    sleep "$LOOP_INTERVAL"
  done
else
  drain_once
fi
