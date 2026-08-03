---
name: diagnose-party-time
description: Diagnoses party-time outages by walking the request path top-down — Cloudflare tunnel, nginx, mDNS name resolution, Docker containers, then the app itself — proving each layer with a command before moving to the next. Use when the user says party-time is down, broken, or "not working"; reports a 502 or "Bad Gateway", a blank page, "Failed to fetch", "Unexpected token '<'", or any page-load error; says an invite link is not working or shows raw JSON; says the admin UI or dashboard will not load; or asks why invites.panahi-systems.com or party-time.nginx-internal.local is not responding.
---

# Diagnose party-time

Most party-time outages are **name resolution**, not application bugs. nginx points at
`docker.local` by mDNS name, and that name has broken in several different ways.
Work top-down through the layers and prove each one before moving on.

## Rules

- **Work top-down. Do not guess.** Every claim you make must be backed by the output of a
  command you actually ran. "Probably the containers" is not a diagnosis.
- **First question, before anything else: is the code you're debugging even live?**
  Compare the deployed SHA to `origin/main` — see Step 0 below. Chasing a bug
  that was already fixed on `main` but never deployed wastes the rest of this
  workflow.
- **Establish scope early**: is the *whole site* down, or does *one URL* misbehave?
  A site-wide failure is Steps 0–5. A single misbehaving URL is Step 6.
- **Never report it fixed without re-testing the original failing URL end to end.**
  A green `systemctl` is not a working site.
- Read-only first. `ops/healthcheck.sh` in this repo sweeps every layer —
  including the SHA-vs-origin/main check — without changing anything. Run it
  first for a fast picture, then use the steps below to drill into whatever it
  reported FAIL.

## Topology

```
Public:  Internet → Cloudflare Tunnel → cloudflared on nginx-cloudflared (.77)
                  → nginx on .77 → docker.local:8080 → party-time-public → Postgres

Admin:   LAN → nginx on nginx-internal (.85) → docker.local:8081 → party-time-admin → Postgres
```

| Host | IP | Runs |
|---|---|---|
| nginx-cloudflared | 192.168.68.77 | cloudflared + nginx (public edge) |
| docker | 192.168.68.78 | party-time-public `:8080`, party-time-admin `:8081`, party-time-db (postgres:17) |
| nginx-internal | 192.168.68.85 | nginx (admin UI) |

Public URL: `https://invites.panahi-systems.com`  Admin URL: `http://party-time.nginx-internal.local/`
SSH to any VM as `ubuntu@<ip>` or `ubuntu@<name>.local`.

> **The nginx upstreams reference `docker.local` by mDNS name.** Keep that in mind at
> every step — it is the single most common root cause.

## Step 0 — Is the running code even the code you're debugging?

Before touching any infrastructure layer, rule out the cheapest and most
common cause of "I fixed this and it's still broken": the fix was never
deployed.

```bash
curl -s https://invites.panahi-systems.com/healthz
curl -s http://party-time.nginx-internal.local/healthz
git rev-parse --short origin/main
```

`/healthz` returns `{"ok":true,"sha":"<sha>"}`, compiled in at build time. If
either edge's `sha` doesn't match `origin/main`, stop diagnosing the app —
the fix hasn't shipped. Hand off to `deploy-party-time`. `ops/healthcheck.sh`
(section 9) runs this exact comparison for both edges automatically.

If `/healthz` itself doesn't respond, that's informative too — treat it the
same as any other layer failure and continue with Step 1.

## Step 1 — Which layer failed? Read the error page

This is the highest-value single check for a site-wide failure. The error page itself
says which layer broke.

```bash
curl -s -D- -o /dev/null https://invites.panahi-systems.com/
```

Inspect the status **and the content-type**:

| What you see | What it means | Go to |
|---|---|---|
| Body `error code: 502` with `content-type: text/plain` | **Cloudflare's own** error page. The tunnel cannot reach nginx — nginx is likely **down**. | Step 3 |
| An **HTML** 502 page from nginx | nginx is **up** but cannot reach the backend. | Step 4 |
| Page shell loads, browser shows "Failed to fetch" / "Unexpected token '<'" | The HTML served fine; the SPA's XHR failed. | Step 5, then 6 |

Do not skip this by assuming "502 means backend down". A Cloudflare 502 and an nginx 502
point at completely different machines.

## Step 2 — Is it just name resolution on the client?

If the user cannot reach `party-time.nginx-internal.local` (the admin app hostname)
at all, check the Mac first before blaming the server.

```bash
dscacheutil -q host -a name party-time.nginx-internal.local
dscacheutil -q host -a name nginx-internal.local
dscacheutil -q host -a name docker.local
dscacheutil -q host -a name nginx-cloudflared.local
```

If `nginx-internal.local` (the VM's own name) resolves but
`party-time.nginx-internal.local` does not, the VM is fine but its
`party-time-mdns-alias` systemd unit has died — see `ops/AGENT.md` hazard 6e.

Compare **several** `.local` hosts at once. If *all* fail, the Mac is off the LAN/VPN or
mDNS is dead locally. If only *some* fail, suspect an **avahi hostname conflict** →
hand off to the **`fix-homelab-mdns`** skill.

## Step 3 — Is nginx up?

```bash
ssh ubuntu@192.168.68.77 'systemctl is-active nginx; sudo nginx -t'
```

> **KEY FAILURE MODE — nginx resolves upstream hostnames ONCE at config-parse time and
> REFUSES TO START if resolution fails.**
>
> Symptom: `is-active` → `failed`, and `nginx -t` → `host not found in upstream "docker.local:8080"`.
>
> This means a **transient** DNS blip leaves nginx **permanently down** long after the
> blip is over. Fix resolution first (Step 4 / `fix-homelab-mdns`), *then*
> `sudo systemctl start nginx`. Restarting before resolution works will just fail again.

Also check cloudflared on the same host:

```bash
ssh ubuntu@192.168.68.77 'systemctl is-active cloudflared; sudo journalctl -u cloudflared -n 20 --no-pager'
```

> `Unable to reach the origin service ... dial tcp 127.0.0.1:80: connect: connection refused`
> means **nginx is down**, NOT a tunnel problem. Do not go chasing Cloudflare.

## Step 4 — Can nginx reach the backend?

```bash
ssh ubuntu@192.168.68.77 'getent hosts docker.local; curl -s -o /dev/null -w "%{http_code}\n" --max-time 5 http://docker.local:8080/invites'
```

(Same on `192.168.68.85` against `docker.local:8081` for the admin path.)

**If `getent` returns no IP or the wrong IP** → mDNS problem → **`fix-homelab-mdns`** skill.

Then check for a stale hardcoded override:

```bash
ssh ubuntu@192.168.68.77 'grep -n local /etc/hosts'
```

> `nsswitch.conf` lists `files` **before** `mdns4_minimal`, so a line in `/etc/hosts`
> silently overrides mDNS **forever**. This has actually happened: a stale
> `192.168.68.89 docker.local` pinned a dead IP after a DHCP change, and mDNS was working
> perfectly the whole time.

And read nginx's own error log:

```bash
ssh ubuntu@192.168.68.77 'sudo tail -20 /var/log/nginx/error.log'
```

Look for `connect() failed (113: No route to host) while connecting to upstream` — and note
**the upstream IP it actually used**. That IP is the evidence: compare it to the docker
VM's real address.

## Step 5 — Are the containers healthy?

```bash
ssh ubuntu@docker.local 'docker ps --format "{{.Names}}\t{{.Status}}"; docker logs --tail 20 party-time-public'
```

Expect `party-time-public`, `party-time-admin`, and `party-time-db` (the latter `(healthy)`).

Then verify the docker VM still **has an IPv4 address** — it has silently lost one before:

```bash
ssh ubuntu@docker.local 'ip -4 -o addr show enp6s18; networkctl status enp6s18 | grep State:'
```

> State `degraded (failed)` with **no `inet` line** means the interface lost its DHCP lease.
> Fix: `sudo networkctl reconfigure enp6s18`.
>
> **The containers keep running the entire time this is broken**, which makes it very
> confusing — `docker ps` looks perfect while nothing can reach the box.

## Step 6 — Application-level

Use this when the infrastructure is proven healthy but one URL misbehaves.

**`GET /admin` returning Gin's plain-text 404 is BY DESIGN.** `/admin` is an API prefix,
not a page. The admin SPA routes are `/`, `/contacts`, and `/event/:id` — **the dashboard
is the ROOT URL**. Do not treat a 404 on `/admin` as an outage.

**HTTP 400 `invalid date format, expected YYYY-MM-DDTHH:MM` on event create/update.**
The handler maps *any* error from `parseCentralTime` to that one message — including a
**missing timezone database**. If this recurs, check that `import _ "time/tzdata"` is
still present in `public_backend/main.go`: the Alpine image ships no tzdata and
`CGO_ENABLED=0` rules out the system fallback. Tests cannot catch this, because dev hosts
have zoneinfo.

**"Unexpected token '<'" in the invitee UI.** The SPA route and the API route share the
same URL (`/invite/:id`). nginx splits them on the `Accept` header and sets
`Cache-Control: no-store` on both branches. If this reappears, a cache is serving the
wrong representation — verify:

```bash
curl -s -D- -o /dev/null -H 'Accept: */*' https://invites.panahi-systems.com/invite/<id>
```

That must return **`application/json`** *and* **`cache-control: no-store`**. An HTML body
here means a cache is replaying the browser representation to the SPA's fetch.

## Database

```bash
ssh ubuntu@docker.local 'source /opt/party-time/.env.prod; docker exec party-time-db psql -U "$DBUSER" -d party_time -c "SELECT id,name,date,status FROM party_time.events;"'
```

> The schema is **`party_time`**, not `public`. An unqualified `SELECT * FROM events`
> will look like the data is gone.

## Handoffs

| Finding | Next |
|---|---|
| `.local` names resolve wrongly / inconsistently, avahi conflict | **`fix-homelab-mdns`** skill |
| Infrastructure healthy, code is stale or wrong | **`deploy-party-time`** skill |
| Need to confirm the admin write path end to end after a fix | **`party-time-create-event`** skill |
