#!/usr/bin/env bash
# The single post-merge deploy command. Refuses to run on a dirty tree or a
# non-main branch (see hard rules — those refusals are cheap and MUST happen
# before ./build.sh, which is not), builds, ships, verifies the playbook
# reported success, then verifies the deployed SHA and runs the existing
# smoke checks. See ops/AGENT.md for the full deploy procedure this wraps.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

ALLOW_DIRTY=false
ALLOW_BRANCH=false
NGINX_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --allow-dirty)  ALLOW_DIRTY=true ;;
    --allow-branch) ALLOW_BRANCH=true ;;
    --nginx-only)   NGINX_ONLY=true ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: $0 [--nginx-only] [--allow-dirty] [--allow-branch]" >&2
      exit 1
      ;;
  esac
done

# ── 1. Refuse a dirty tree or a non-main branch ──────────────────────────────
# These checks run before anything expensive (build.sh, ansible) so a bad
# invocation fails in milliseconds, not minutes.
if [ -n "$(git status --porcelain)" ] && [ "$ALLOW_DIRTY" != true ]; then
  echo "REFUSING: working tree is dirty." >&2
  echo "  Commit or stash your changes, or pass --allow-dirty to override." >&2
  git status --short >&2
  exit 1
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$CURRENT_BRANCH" != "main" ] && [ "$ALLOW_BRANCH" != true ]; then
  echo "REFUSING: current branch is '$CURRENT_BRANCH', not main." >&2
  echo "  Switch to main, or pass --allow-branch to override." >&2
  exit 1
fi

# ── 2. Refuse if local main is behind origin/main ───────────────────────────
echo "Fetching origin..."
git fetch origin --quiet
if [ "$CURRENT_BRANCH" = "main" ]; then
  LOCAL_SHA="$(git rev-parse HEAD)"
  REMOTE_SHA="$(git rev-parse origin/main)"
  if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
    MERGE_BASE="$(git merge-base HEAD origin/main)"
    if [ "$MERGE_BASE" = "$LOCAL_SHA" ]; then
      echo "REFUSING: local main is behind origin/main." >&2
      echo "  git pull, then re-run ./deploy.sh." >&2
      exit 1
    fi
  fi
fi

GIT_SHA="$(git rev-parse --short HEAD)"

# ── 3. Build ─────────────────────────────────────────────────────────────────
# --nginx-only exists to be the fast path for a config-only vhost change, so it
# skips the cross-build entirely — the nginx plays never touch the backend
# image. They do rsync the built UI directories, so those must already exist;
# refuse rather than silently shipping a stale or absent web root.
if [ "$NGINX_ONLY" = true ]; then
  for d in invitee_ui/dist admin_ui/dist; do
    if [ ! -d "$ROOT/$d" ]; then
      echo "REFUSING: --nginx-only skips the build, but $d does not exist." >&2
      echo "  Run ./build.sh once, then re-run with --nginx-only." >&2
      exit 1
    fi
  done
  echo "=== Skipping build (--nginx-only) ==="
else
  echo "=== Building ==="
  ./build.sh
fi

# ── 4. Deploy via ansible, output to a timestamped log — NEVER through a filter ──
# Hard rule: never pipe ansible-playbook through tail/head/grep. Output
# buffers in the pipe and is lost entirely if the process is killed, leaving
# zero diagnostics. Redirect to a file instead, printed up front so a killed
# run still leaves the operator somewhere to look.
LOG_DIR="$ROOT/dist"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/deploy-$(date -u +%Y%m%dT%H%M%SZ).log"
echo "Deploy log: $LOG_FILE"

ANSIBLE_ARGS=("$ROOT/deploy/party-time.yml" -e "party_time_repo=$ROOT")
[ "$ALLOW_DIRTY" = true ]  && ANSIBLE_ARGS+=(-e allow_dirty=true)
[ "$ALLOW_BRANCH" = true ] && ANSIBLE_ARGS+=(-e allow_branch=true)
if [ "$NGINX_ONLY" = true ]; then
  ANSIBLE_ARGS+=(--tags nginx)
  echo "=== Deploying (nginx-only) ==="
else
  echo "=== Deploying ==="
fi

set +e
# Must run with cwd inside homelab/ansible: the dynamic inventory
# (inventory/proxmox.yml) unvaults group_vars/all/vault.yml via a path
# relative to the process's cwd, not to ansible.cfg's location. Running
# from party-time's root makes that lookup fail, the inventory silently
# parses as empty, and every play gets skipped with no error — see the
# PLAY RECAP check below for why that used to look like a false success.
(cd ~/Documents/Workspace/homelab/ansible && ANSIBLE_CONFIG=./ansible.cfg \
  ansible-playbook "${ANSIBLE_ARGS[@]}") > "$LOG_FILE" 2>&1
ANSIBLE_EXIT=$?
set -e

if [ "$ANSIBLE_EXIT" -ne 0 ]; then
  echo "REFUSING to declare success: ansible-playbook exited $ANSIBLE_EXIT." >&2
  echo "  See $LOG_FILE" >&2
  exit 1
fi

# ── 5. Parse PLAY RECAP: require failed=0 and unreachable=0 for every host ──
# ansible-playbook exits 0 when the inventory fails to parse and NO hosts
# match — every play is skipped and the recap is empty. That has happened
# here (a vault path that only resolves from homelab's ansible dir), and a
# naive check reports a successful deploy that shipped nothing. So this does
# not just look for a recap: it requires each host we expect to actually
# appear in it.
echo "=== Checking play recap ==="
RECAP="$(awk '/PLAY RECAP/{flag=1; next} flag' "$LOG_FILE" | grep -E '.:' || true)"
if [ -z "$RECAP" ]; then
  echo "REFUSING: PLAY RECAP lists no hosts — nothing was deployed." >&2
  echo "  Usually the dynamic inventory failed to parse (check the top of the log)." >&2
  echo "  See $LOG_FILE" >&2
  exit 1
fi
echo "$RECAP"

# Which hosts must have been touched, given what we asked for.
if [ "$NGINX_ONLY" = true ]; then
  EXPECTED_HOSTS=(nginx-cloudflared nginx-internal)
else
  EXPECTED_HOSTS=(docker nginx-cloudflared nginx-internal)
fi
for host in "${EXPECTED_HOSTS[@]}"; do
  if ! printf '%s\n' "$RECAP" | grep -q "$host"; then
    echo "REFUSING: host '$host' is absent from PLAY RECAP — it was never deployed to." >&2
    echo "  See $LOG_FILE" >&2
    exit 1
  fi
done

# awk, not grep -E 'failed=0.*unreachable=0': ansible's recap prints
# unreachable= before failed=, so a single ordered regex silently flags every
# healthy line as bad (seen in practice — see git history for this line).
BAD_HOSTS="$(printf '%s\n' "$RECAP" | awk '!/failed=0/ || !/unreachable=0/' || true)"
if [ -n "$BAD_HOSTS" ]; then
  echo "REFUSING: non-zero failed/unreachable in play recap:" >&2
  echo "$BAD_HOSTS" >&2
  echo "  See $LOG_FILE" >&2
  exit 1
fi
echo "Play recap clean."

if [ "$NGINX_ONLY" = true ]; then
  echo ""
  echo "=== nginx-only deploy complete ==="
  exit 0
fi

# ── 6. Verify /healthz SHA on both edges ────────────────────────────────────
echo "=== Verifying deployed SHA ==="
verify_sha() {
  local label="$1" url="$2"
  local sha
  sha="$(curl -s --max-time 10 "$url" | grep -o '"sha":"[^"]*"' | cut -d'"' -f4)"
  if [ "$sha" != "$GIT_SHA" ]; then
    echo "REFUSING: $label /healthz reports sha='$sha', expected '$GIT_SHA'." >&2
    exit 1
  fi
  echo "  $label sha=$sha (matches)"
}
verify_sha "public edge" "https://party-time.panahi-systems.com/healthz"
verify_sha "admin edge"  "http://nginx-internal.local/healthz"

# ── 7. Existing smoke checks (see ops/healthcheck.sh for the URLs) ─────────
echo "=== Smoke checks ==="
smoke_check() {
  local label="$1" url="$2"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url")"
  if [ "$code" != "200" ]; then
    echo "REFUSING: $label -> $code ($url)" >&2
    exit 1
  fi
  echo "  $label -> 200 ($url)"
}
smoke_check "admin UI"   "http://nginx-internal.local/"
smoke_check "admin API"  "http://nginx-internal.local/admin/events"
smoke_check "public site" "https://party-time.panahi-systems.com/"

echo ""
echo "=== Deploy complete: sha=$GIT_SHA ==="
