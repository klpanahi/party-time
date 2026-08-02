#!/usr/bin/env bash
#
# party-time homelab healthcheck — READ-ONLY.
#
# Sweeps every layer of the request path and prints PASS/FAIL per check.
# This script NEVER restarts, modifies, deploys, or repairs anything. It only
# looks. Use the `diagnose-party-time` skill to act on whatever comes back FAIL.
#
# Exit status: 0 if every check passed, 1 if any check failed.

set -uo pipefail
# NOTE: deliberately no `set -e` — individual checks are expected to fail and
# the script must keep going to produce a complete picture.

NGINX_CF=192.168.68.77   # nginx-cloudflared: cloudflared + public nginx
DOCKER_VM=192.168.68.78  # docker: containers + postgres
NGINX_INT=192.168.68.85  # nginx-internal: admin nginx

PUBLIC_URL="https://party-time.panahi-systems.com/"
ADMIN_URL="http://nginx-internal.local/"
ADMIN_API_URL="http://nginx-internal.local/admin/events"

SSH_OPTS=(-o ConnectTimeout=8 -o BatchMode=yes -o StrictHostKeyChecking=accept-new)

PASSED=0
FAILED=0

if [ -t 1 ]; then
    C_PASS=$'\033[32m'; C_FAIL=$'\033[31m'; C_HEAD=$'\033[1m'; C_OFF=$'\033[0m'
else
    C_PASS=""; C_FAIL=""; C_HEAD=""; C_OFF=""
fi

pass() { PASSED=$((PASSED + 1)); printf '%sPASS%s  %s\n' "$C_PASS" "$C_OFF" "$1"; }
fail() { FAILED=$((FAILED + 1)); printf '%sFAIL%s  %s\n' "$C_FAIL" "$C_OFF" "$1"; }

section() { printf '\n%s-- %s%s\n' "$C_HEAD" "$1" "$C_OFF"; }

# Run a command on a VM over SSH. Never interactive, never hangs.
remote() {
    local host="$1"; shift
    ssh "${SSH_OPTS[@]}" "ubuntu@${host}" "$@" 2>/dev/null
}

# Collapse multi-line command output onto one line for tidy reporting.
oneline() { tr '\n\t' '  ' | sed -e 's/  */ /g' -e 's/ *$//'; }

printf '%s=======================================================%s\n' "$C_HEAD" "$C_OFF"
printf '%s party-time healthcheck (read-only)%s\n' "$C_HEAD" "$C_OFF"
printf '%s %s%s\n' "$C_HEAD" "$(date '+%Y-%m-%d %H:%M:%S')" "$C_OFF"
printf '%s=======================================================%s\n' "$C_HEAD" "$C_OFF"

# --------------------------------------------------------------------------
section "1. mDNS resolution from this machine"
# --------------------------------------------------------------------------
resolve_host() {
    # Echo the resolved IPv4, or nothing. macOS first, getent as fallback.
    local name="$1" out=""
    if command -v dscacheutil >/dev/null 2>&1; then
        out=$(dscacheutil -q host -a name "$name" 2>/dev/null \
              | awk '/^ip_address:/ {print $2; exit}')
    fi
    if [ -z "$out" ] && command -v getent >/dev/null 2>&1; then
        out=$(getent hosts "$name" 2>/dev/null | awk '{print $1; exit}')
    fi
    if [ -z "$out" ] && command -v dig >/dev/null 2>&1; then
        out=$(dig +short +time=2 +tries=1 "$name" A 2>/dev/null | head -1)
    fi
    printf '%s' "$out"
}

for name in docker.local nginx-internal.local nginx-cloudflared.local; do
    ip=$(resolve_host "$name")
    if [ -n "$ip" ]; then
        pass "mDNS $name -> $ip"
    else
        fail "mDNS $name did not resolve (see the fix-homelab-mdns skill)"
    fi
done

# --------------------------------------------------------------------------
section "2. Host reachability (ping)"
# --------------------------------------------------------------------------
ping_once() {
    # macOS -W is milliseconds; Linux -W is seconds.
    if [ "$(uname -s)" = "Darwin" ]; then
        ping -c 1 -W 2000 -t 3 "$1" >/dev/null 2>&1
    else
        ping -c 1 -W 2 "$1" >/dev/null 2>&1
    fi
}

for entry in "nginx-cloudflared:$NGINX_CF" "docker:$DOCKER_VM" "nginx-internal:$NGINX_INT"; do
    label="${entry%%:*}"; ip="${entry##*:}"
    if ping_once "$ip"; then
        pass "ping $label ($ip)"
    else
        fail "ping $label ($ip) — no response"
    fi
done

# --------------------------------------------------------------------------
section "3. nginx service"
# --------------------------------------------------------------------------
for entry in "nginx-cloudflared:$NGINX_CF" "nginx-internal:$NGINX_INT"; do
    label="${entry%%:*}"; ip="${entry##*:}"
    state=$(remote "$ip" 'systemctl is-active nginx' | oneline)
    if [ "$state" = "active" ]; then
        pass "nginx on $label ($ip) is active"
    elif [ -z "$state" ]; then
        fail "nginx on $label ($ip) — could not query (SSH failed?)"
    else
        fail "nginx on $label ($ip) is '$state' — check 'sudo nginx -t'; an unresolvable upstream stops nginx starting"
    fi
done

# --------------------------------------------------------------------------
section "4. cloudflared service"
# --------------------------------------------------------------------------
state=$(remote "$NGINX_CF" 'systemctl is-active cloudflared' | oneline)
if [ "$state" = "active" ]; then
    pass "cloudflared on nginx-cloudflared ($NGINX_CF) is active"
elif [ -z "$state" ]; then
    fail "cloudflared on nginx-cloudflared ($NGINX_CF) — could not query (SSH failed?)"
else
    fail "cloudflared on nginx-cloudflared ($NGINX_CF) is '$state'"
fi

# --------------------------------------------------------------------------
section "5. Containers on docker ($DOCKER_VM)"
# --------------------------------------------------------------------------
ps_out=$(remote "$DOCKER_VM" 'docker ps --format "{{.Names}}\t{{.Status}}"')
if [ -z "$ps_out" ]; then
    fail "docker ps returned nothing — SSH failed, or no containers are running"
else
    for c in party-time-public party-time-admin party-time-db; do
        line=$(printf '%s\n' "$ps_out" | grep -E "^${c}[[:space:]]" | oneline)
        if [ -z "$line" ]; then
            fail "container $c is not running"
        elif printf '%s' "$line" | grep -q 'Up'; then
            pass "container $line"
        else
            fail "container $line"
        fi
    done

    # Postgres declares a healthcheck, so its status should say (healthy).
    db_line=$(printf '%s\n' "$ps_out" | grep -E '^party-time-db[[:space:]]' | oneline)
    if printf '%s' "$db_line" | grep -q '(healthy)'; then
        pass "postgres reports healthy"
    elif [ -z "$db_line" ]; then
        fail "postgres health unknown — party-time-db is not running"
    else
        fail "postgres is not healthy: $db_line"
    fi
fi

# --------------------------------------------------------------------------
section "6. Network interface on docker ($DOCKER_VM)"
# --------------------------------------------------------------------------
addr=$(remote "$DOCKER_VM" 'ip -4 -o addr show enp6s18' | oneline)
if printf '%s' "$addr" | grep -q 'inet '; then
    ipv4=$(printf '%s' "$addr" | awk '{for(i=1;i<=NF;i++) if($i=="inet") {print $(i+1); exit}}')
    pass "enp6s18 has IPv4 $ipv4"
else
    ifstate=$(remote "$DOCKER_VM" 'networkctl status enp6s18 2>/dev/null | grep State:' | oneline)
    fail "enp6s18 has NO IPv4 address ${ifstate:+($ifstate)} — lost its DHCP lease; containers keep running while this is broken"
fi

# --------------------------------------------------------------------------
section "7. nginx -> backend, by name (from $NGINX_CF)"
# --------------------------------------------------------------------------
getent_out=$(remote "$NGINX_CF" 'getent hosts docker.local' | oneline)
if [ -n "$getent_out" ]; then
    resolved_ip=$(printf '%s' "$getent_out" | awk '{print $1}')
    if [ "$resolved_ip" = "$DOCKER_VM" ]; then
        pass "getent hosts docker.local -> $resolved_ip"
    else
        fail "getent hosts docker.local -> $resolved_ip (expected $DOCKER_VM) — stale /etc/hosts entry or mDNS conflict"
    fi
else
    fail "getent hosts docker.local resolved nothing on $NGINX_CF — see the fix-homelab-mdns skill"
fi

code=$(remote "$NGINX_CF" 'curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://docker.local:8080/invites' | oneline)
if [ "$code" = "200" ]; then
    pass "http://docker.local:8080/invites from $NGINX_CF -> 200"
else
    fail "http://docker.local:8080/invites from $NGINX_CF -> ${code:-no response}"
fi

# --------------------------------------------------------------------------
section "8. HTTP endpoints"
# --------------------------------------------------------------------------
check_url() {
    local url="$1" label="$2"
    local code
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url" 2>/dev/null)
    if [ "$code" = "200" ]; then
        pass "$label -> 200  ($url)"
    else
        fail "$label -> ${code:-no response}  ($url)"
    fi
}

check_url "$ADMIN_URL"     "admin UI"
check_url "$ADMIN_API_URL" "admin API"
check_url "$PUBLIC_URL"    "public site"

# --------------------------------------------------------------------------
printf '\n%s=======================================================%s\n' "$C_HEAD" "$C_OFF"
if [ "$FAILED" -eq 0 ]; then
    printf '%s ALL CHECKS PASSED%s  (%d passed)\n' "$C_PASS" "$C_OFF" "$PASSED"
    printf '%s=======================================================%s\n' "$C_HEAD" "$C_OFF"
    exit 0
fi

printf '%s %d FAILED%s, %d passed\n' "$C_FAIL" "$FAILED" "$C_OFF" "$PASSED"
printf ' Work the failures top-down — the earliest FAIL is usually the cause\n'
printf ' of every later one. See the diagnose-party-time skill.\n'
printf '%s=======================================================%s\n' "$C_HEAD" "$C_OFF"
exit 1
