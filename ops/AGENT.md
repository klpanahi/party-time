# party-time — Operations Manual

Master operations reference for the `party-time` application running on the homelab
Proxmox cluster. Written for an engineer or agent who has never seen this system.

Read the [Known Issues & Hazards](#known-issues--hazards) section before your first
deploy. Most of the time lost on this system has been lost to items 2, 3, and 6.

---

## Overview

`party-time` is a party invitation app: an admin creates events and contacts,
invites guests, and sends them SMS invite links. Guests open a public invite link
and RSVP.

It runs as two instances of the **same** Go binary, separated by network exposure:

| Instance | Container | Port | `ADMIN_ENABLED` | Reachable from |
|---|---|---|---|---|
| Public | `party-time-public` | `8080` | `false` | Internet, via Cloudflare Tunnel |
| Admin | `party-time-admin` | `8081` | `true` | LAN only |

Both run image `party-time-backend:latest`. The only difference is the
`ADMIN_ENABLED` env var, which gates registration of the `/admin/*` route group.
Both share one Postgres database.

| Surface | URL |
|---|---|
| Public invitee UI | `https://party-time.panahi-systems.com` |
| Admin UI | `http://nginx-internal.local/` |
| Proxmox | `https://192.168.68.65:8006` |

---

## Architecture

### Infrastructure

| VM ID | Name | Proxmox tags | IP | Role |
|---|---|---|---|---|
| 201 | `nginx-cloudflared` | `ansible`, `nginx`, `cloudflared` | `192.168.68.77` | Public edge. Serves `/var/www/invitee-ui`. Runs the `cloudflared` tunnel for `https://party-time.panahi-systems.com` |
| 202 | `docker` | `ansible`, `docker` | `192.168.68.78` | Runs the 3 application containers. **2 vCPU / 2 GB RAM / NO SWAP** |
| 203 | `nginx-internal` | `ansible`, `nginx-internal` | `192.168.68.85` | LAN-only admin UI at `http://nginx-internal.local/`. Serves `/var/www/admin-ui` |

### Containers on VM 202 (`docker`)

| Container | Image | Port mapping | Notes |
|---|---|---|---|
| `party-time-public` | `party-time-backend:latest` | `8080:8080` | `ADMIN_ENABLED=false` |
| `party-time-admin` | `party-time-backend:latest` | `8081:8080` | `ADMIN_ENABLED=true` |
| `party-time-db` | `postgres:17` | — | Volume `pgdata`, DB `party_time` |

Secrets live in **`/opt/party-time/.env.prod` on VM 202 only**. This file is never
shipped from the control node. The deploy playbook checks that it exists and fails
fast if it does not — it does not create it.

### Request flow

```
PUBLIC
  Internet
     |
     v
  Cloudflare Tunnel  (cloudflared.service on VM 201)
     |
     v
  nginx :80  on 192.168.68.77  ── static ──> /var/www/invitee-ui
     |                                        (invitee_ui React SPA)
     | upstream public_backend -> docker.local:8080     <-- mDNS NAME, not IP
     v
  party-time-public  (ADMIN_ENABLED=false)
     |
     v
  party-time-db (postgres:17)


ADMIN
  LAN client
     |
     v
  nginx :80  on 192.168.68.85  ── static ──> /var/www/admin-ui
     |                                        (admin_ui React SPA)
     | upstream admin_backend -> docker.local:8081      <-- mDNS NAME, not IP
     v
  party-time-admin   (ADMIN_ENABLED=true)
     |
     v
  party-time-db (postgres:17)
```

> **The single most important fact on this page:** both nginx upstreams reference
> `docker.local` **by mDNS name**, not by IP. nginx resolves upstream names **once,
> at config-parse time**. mDNS is the #1 source of outages in this system — see
> hazards 6 and 7.

### Access

```bash
ssh ubuntu@192.168.68.78          # by IP
ssh ubuntu@docker.local           # by mDNS name
ssh ubuntu@nginx-cloudflared.local
ssh ubuntu@nginx-internal.local
```

All VMs share a single SSH key (`~/.ssh/id_ed25519` per `ansible/ansible.cfg`).
There is no per-VM key.

### Ansible groups

The inventory (`ansible/inventory/proxmox.yml`) is **dynamic**: it queries the
Proxmox API, builds groups from each VM's Proxmox tags with a `tag` prefix, and
derives `ansible_host` from the IP the QEMU guest agent reports. There are no
static IP lists to maintain.

| Proxmox tag | Ansible group | Members |
|---|---|---|
| `ansible` | `tag_ansible` | all managed VMs (201, 202, 203) |
| `nginx` | `tag_nginx` | 201 |
| `cloudflared` | `tag_cloudflared` | 201 |
| `docker` | `tag_docker` | 202 |
| `nginx-internal` | `tag_nginx_internal` | 203 |

> **Note the hyphen.** Ansible group names cannot contain hyphens, so the Proxmox
> tag `nginx-internal` becomes the group `tag_nginx_internal` (underscore). Using
> `tag_nginx-internal` in a playbook or `--limit` will silently match nothing.

---

## Repositories

`party-time` now owns everything about how the app is built, served, and
shipped — one feature is one branch is one PR. `homelab` keeps only generic
infrastructure. `party-time-ops` (this document's old home) is archived; see
its `README.md` for where everything went.

| Repo | Path | Contains |
|---|---|---|
| `homelab` | `~/Documents/Workspace/homelab` | Terraform (VM provisioning) + Ansible (generic install/baseline configuration) |
| `party-time` | `~/Documents/Workspace/party-time` | Go/Gin backend, two React SPAs, the deploy playbook and nginx vhost configs, this document (`ops/AGENT.md`), and the companion skills |
| `party-time-ops` | `~/Documents/Workspace/party-time-ops` | **Archived.** Tombstone `README.md` only. |

### `homelab` — key files

| Path | Purpose |
|---|---|
| `ansible/site.yml` | Base configuration — avahi/mDNS, nginx (install/baseline only), cloudflared, docker roles |
| `ansible/group_vars/tag_nginx.yml` | Public nginx group vars — `nginx_remove_default_vhost` only; the vhost itself lives in `party-time` now |
| `ansible/group_vars/tag_nginx_internal.yml` | Admin nginx group vars — `nginx_remove_default_vhost` only; the vhost itself lives in `party-time` now |
| `ansible/inventory/proxmox.yml` | Dynamic inventory from the Proxmox API |
| `ansible/ansible.cfg` | Sets inventory, `remote_user = ubuntu`, vault password file, `roles_path` |

### `party-time` — key paths

| Path | Purpose |
|---|---|
| `public_backend/` | Go/Gin backend. `main.go` (routes), `helpers.go` (`parseCentralTime`), `admin_handlers.go`, `worker.go` (Twilio text worker) |
| `admin_ui/` | React admin SPA. Routes `/`, `/contacts`, `/event/:id`. API base is `/admin` |
| `invitee_ui/` | React invitee SPA. Route `/invite/:id` |
| `build.sh` | Builds all artifacts, tests first |
| `docker-compose.prod.yml` | The 3-service production stack |
| `public_backend/migrations/` | Goose migrations — canonical schema, embedded in the binary, applied by the one-shot `migrate` compose service |
| `sample.local.env` | Template for `.env.prod` — documents every supported variable |
| `deploy/party-time.yml` | Application deploy playbook (3 plays: docker backend, public nginx vhost + invitee UI, admin nginx vhost + admin UI) |
| `deploy/nginx/public.conf` | Public vhost body — single source of truth, applied by `deploy/party-time.yml` via the `geerlingguy.nginx` role |
| `deploy/nginx/admin.conf` | Admin vhost body — single source of truth, applied by `deploy/party-time.yml` via the `geerlingguy.nginx` role |
| `ops/` | This document, the incident log, and `healthcheck.sh` |
| `.claude/skills/` | `develop-party-time`, `deploy-party-time`, `diagnose-party-time`, `party-time-create-event` |

### Backend routes

Public routes, registered on **both** instances:

```
GET  /invites
GET  /invite/:id
PUT  /invite/:id
GET  /event/:id
```

Admin routes, registered **only when `ADMIN_ENABLED=true`**, all under the `/admin` prefix:

```
GET  /admin/contacts            POST /admin/contacts        PUT  /admin/contacts/:id
GET  /admin/events              POST /admin/events
GET  /admin/events/:id          PUT  /admin/events/:id
POST /admin/events/:id/invites  POST /admin/events/:id/messages
GET  /admin/events/:id/texts    POST /admin/events/:id/launch
POST /admin/texts/:id/resend
```

There is **no delete route for any resource.** See hazard 11.

---

## Deploy Procedure

### Step 1 — Build and test locally

```bash
cd ~/Documents/Workspace/party-time && ./build.sh
```

`build.sh` runs the full test suite **before** building anything and exits non-zero
on any failure:

1. Starts a local Postgres via `docker-compose.yml` (**Docker must be running**)
2. `go test ./...` in `public_backend`
3. `npx vitest run` in `admin_ui`
4. `npx vitest run` in `invitee_ui`
5. On green: builds `admin_ui/dist`, `invitee_ui/dist`, and the Docker image
   `party-time-backend:latest`

If `build.sh` fails, stop. Do not deploy.

### Step 2 — Deploy

The playbook now lives in `party-time` itself and needs `homelab`'s
`ansible.cfg` on `ANSIBLE_CONFIG` so `roles_path` resolves the
`geerlingguy.nginx` role (installed in `homelab/ansible/roles/`, gitignored,
via `ansible-galaxy`):

```bash
cd ~/Documents/Workspace/party-time
ANSIBLE_CONFIG=~/Documents/Workspace/homelab/ansible/ansible.cfg \
  ansible-playbook deploy/party-time.yml -e party_time_repo=$PWD
```

The playbook runs three plays:

| Play | Hosts | Actions |
|---|---|---|
| Deploy party-time backend | `tag_docker` | rsync `docker-compose.prod.yml` to `/opt/party-time`; verify `.env.prod` exists; ship and `docker load` the prebuilt `linux/amd64` image, asserting its architecture; `docker_compose_v2` with `build: never`, `recreate: always` — compose's own `migrate` one-shot service runs the embedded goose migrations before either backend container starts |
| Deploy invitee UI to public nginx | `tag_nginx` | rsync `invitee_ui/dist/` → `/var/www/invitee-ui/` (`delete: true`); apply the public vhost (`deploy/nginx/public.conf`) via the `geerlingguy.nginx` role |
| Deploy admin UI to internal nginx | `tag_nginx_internal` | rsync `admin_ui/dist/` → `/var/www/admin-ui/` (`delete: true`); apply the admin vhost (`deploy/nginx/admin.conf`) via the `geerlingguy.nginx` role |

### Step 3 — nginx config-only changes

If you changed only `deploy/nginx/public.conf` or `deploy/nginx/admin.conf` in
this repo, you can still run the full `deploy/party-time.yml`, but you can
also scope it to just the affected group with `--limit` — the rsync of
already-built static files is harmless and fast, and only the `geerlingguy.nginx`
role's vhost application actually needs to happen:

```bash
cd ~/Documents/Workspace/party-time
ANSIBLE_CONFIG=~/Documents/Workspace/homelab/ansible/ansible.cfg \
  ansible-playbook deploy/party-time.yml -e party_time_repo=$PWD --limit tag_nginx            # public edge
ANSIBLE_CONFIG=~/Documents/Workspace/homelab/ansible/ansible.cfg \
  ansible-playbook deploy/party-time.yml -e party_time_repo=$PWD --limit tag_nginx_internal   # admin edge
```

### Timing reality

Every step in the deploy takes **seconds** — except one.

> **"Build and start Docker stack" dominates total deploy time.** It recompiles the
> Go binary *inside* the 2 vCPU / 2 GB / **no swap** guest, while Postgres is
> running in the same VM. Observed load average during this step: **~47**.

Budget for it. Do not assume a long-running deploy is hung — but also see hazard 2
about never discarding the output, and hazard 3 about verifying that a deploy which
*looked* like it ran actually applied anything.

---

## Verification

After any deploy, verify explicitly. A killed or timed-out playbook can leave
**nothing** applied while appearing to have run.

### 1. Container and image age (the authoritative check)

```bash
ssh ubuntu@docker.local 'docker ps --format "{{.Names}} {{.Status}}"; docker images party-time-backend --format "{{.ID}} {{.CreatedSince}}"'
```

Expect three containers `Up` for *seconds/minutes*, and an image `CreatedSince` of
*seconds/minutes*. Hours-old values mean your deploy did not apply, no matter what
the playbook output suggested.

### 2. nginx is actually running on both edges

```bash
ssh ubuntu@nginx-cloudflared.local 'systemctl is-active nginx; sudo nginx -t'
ssh ubuntu@nginx-internal.local    'systemctl is-active nginx; sudo nginx -t'
```

`nginx -t` is the check that catches an unresolvable upstream (hazard 7).

### 3. End-to-end HTTP

```bash
# Public edge, HTML branch — must return the React bundle
curl -sI -H 'Accept: text/html' https://party-time.panahi-systems.com/invite/75368427-e04f-4a09-9187-60d81d02845b

# Public edge, API branch — must return JSON from the backend
curl -s  -H 'Accept: application/json' https://party-time.panahi-systems.com/invite/75368427-e04f-4a09-9187-60d81d02845b

# Admin UI (dashboard is at the ROOT, not /admin)
curl -sI http://nginx-internal.local/

# Admin API through internal nginx
curl -s http://nginx-internal.local/admin/events
```

Both `/invite/:id` responses must carry `Cache-Control: no-store`. If they do not,
see hazard 5.

### 4. Backends directly, bypassing nginx

Isolates "backend is broken" from "nginx cannot reach the backend":

```bash
ssh ubuntu@docker.local 'curl -s localhost:8080/invites; echo; curl -s localhost:8081/admin/events'
```

---

## Database Access

The database is `party_time`, and the schema is **`party_time`, not `public`.**
Unqualified table names will fail unless you set the search path.

```bash
ssh ubuntu@docker.local 'source /opt/party-time/.env.prod; docker exec party-time-db psql -U "$DBUSER" -d party_time -c "SELECT id,name,date,status FROM party_time.events;"'
```

### Tables

| Table | Key columns |
|---|---|
| `contacts` | `id`, `first_name`, `last_name`, `phone_number` (unique) |
| `events` | `id`, `name`, `date` (timestamptz), `description`, `location`, `plus_ones_allowed`, `status` (default `draft`) |
| `invites` | `id` (uuid), `attending` (default `No Response`), `additional_guests`, `event_id`, `contact_id`, `opened_at` |
| `messages` | `id`, `content`, `event_id` |
| `texts` | `id`, `contact_id`, `message_id`, `event_id`, `status` (default `pending`), `content`, `provider_sid`, `error`, `sent_at`, `created_at` |

### Interactive shell

```bash
ssh ubuntu@docker.local
source /opt/party-time/.env.prod
docker exec -it party-time-db psql -U "$DBUSER" -d party_time -c 'SET search_path TO party_time;'
```

### Current test data

| Object | Value |
|---|---|
| Event `id=1` | "Test Event", `2026-08-15`, `status=draft` |
| Event `id=2` | "Test Event 2", `2026-09-05`, `status=draft` |
| Invite | `75368427-e04f-4a09-9187-60d81d02845b` (event 1) |

---

## Common Operations

### Deploy application code

See [Deploy Procedure](#deploy-procedure). Always `build.sh` first.

### Change an nginx vhost or upstream

Edit `deploy/nginx/public.conf` (public) or `deploy/nginx/admin.conf` (admin)
in this repo, then:

```bash
cd ~/Documents/Workspace/party-time
ANSIBLE_CONFIG=~/Documents/Workspace/homelab/ansible/ansible.cfg \
  ansible-playbook deploy/party-time.yml -e party_time_repo=$PWD --limit tag_nginx
```

### Restart the application stack without rebuilding

```bash
ssh ubuntu@docker.local 'cd /opt/party-time && docker compose -f docker-compose.prod.yml restart'
```

### Tail backend logs

```bash
ssh ubuntu@docker.local 'docker logs -f --tail 100 party-time-public'
ssh ubuntu@docker.local 'docker logs -f --tail 100 party-time-admin'
```

### Delete a test event (no API route exists)

```bash
ssh ubuntu@docker.local 'source /opt/party-time/.env.prod; docker exec party-time-db psql -U "$DBUSER" -d party_time -c "DELETE FROM party_time.invites WHERE event_id=2; DELETE FROM party_time.events WHERE id=2;"'
```

Delete child rows in `invites`, `messages`, and `texts` first — they carry foreign
keys to `events`.

### Recover mDNS

```bash
sudo systemctl restart avahi-daemon          # on the affected VM
sudo networkctl reconfigure enp6s18          # on the docker VM, if it lost its IPv4
```

### Restart the Cloudflare tunnel

```bash
ssh ubuntu@nginx-cloudflared.local 'sudo systemctl restart cloudflared; systemctl is-active cloudflared'
```

---

## Troubleshooting

Work the layers outside-in. Each step tells you which layer to blame, so you never
have to guess.

### Decision guide

```
Symptom: the site is broken.
  |
  |-- What kind of error page?
  |     |
  |     |-- text/plain body "error code: 502"      -> CLOUDFLARE's own 502.
  |     |                                             The tunnel cannot reach nginx.
  |     |                                             Check: cloudflared on VM 201, nginx on VM 201.
  |     |
  |     |-- an HTML 502 page                       -> NGINX's own 502.
  |     |                                             nginx is up but cannot reach the backend.
  |     |                                             Check: docker.local resolution, containers on VM 202.
  |     |
  |     |-- HTTP 400 "invalid date format,
  |     |   expected YYYY-MM-DDTHH:MM" on every
  |     |   event create/update, GETs fine        -> Timezone data missing in the image. See hazard 4.
  |     |
  |     |-- raw JSON where the invite page
  |     |   should render, or a stale page that
  |     |   ignores Accept                        -> SPA/API collision or a poisoned cache. See hazard 5.
  |     |
  |     |-- Gin plain-text 404 at /admin          -> Not a bug. /admin is an API prefix. See hazard 10.
  |
  |-- Is nginx even running?
        ssh ubuntu@<nginx vm> 'systemctl is-active nginx'
          |-- "failed" + nginx -t says
          |   'host not found in upstream "docker.local:8080"'
          |                                       -> mDNS failed at config load. See hazards 6 and 7.
          |-- "active"                            -> move down a layer to the backend.
```

### Layer-by-layer checks

| Layer | Check | Healthy result |
|---|---|---|
| 1. Cloudflare edge | `curl -sI https://party-time.panahi-systems.com/` | Not a `text/plain` `error code: 502` |
| 2. Tunnel | `ssh ubuntu@nginx-cloudflared.local 'systemctl is-active cloudflared'` | `active` |
| 3. Public nginx | `ssh ubuntu@nginx-cloudflared.local 'systemctl is-active nginx; sudo nginx -t'` | `active`, `syntax is ok` |
| 4. Name resolution | `ssh ubuntu@nginx-cloudflared.local 'getent hosts docker.local'` | Returns the **current** docker VM IP (`192.168.68.78`) |
| 5. Stale `/etc/hosts` | `ssh ubuntu@nginx-cloudflared.local 'grep -n docker.local /etc/hosts'` | **No output.** Any line here is a bug — see hazard 6a |
| 6. Docker VM network | `ssh ubuntu@docker.local 'ip -4 addr show enp6s18'` | Has an IPv4 address |
| 7. Containers | `ssh ubuntu@docker.local 'docker ps --format "{{.Names}} {{.Status}}"'` | 3 containers `Up` |
| 8. Backend direct | `ssh ubuntu@docker.local 'curl -s localhost:8080/invites'` | JSON |
| 9. Database | `docker exec party-time-db pg_isready -U "$DBUSER"` | `accepting connections` |

### Telling the layers apart from the error page

| Response | Produced by | Means |
|---|---|---|
| `content-type: text/plain`, body `error code: 502` | Cloudflare | The tunnel cannot reach nginx |
| An HTML 502 page | nginx | nginx is up but cannot reach the backend |

This distinction localizes the fault immediately, before any SSH. Check it first.

---

## Known Issues & Hazards

### 1. Slow deploy (RESOLVED 2026-07-31)

Historically the playbook rebuilt the Go image **in-guest**, recompiling inside a
2 vCPU / 2 GB / no-swap VM alongside a running Postgres. Observed load average
**~47**, and it routinely exceeded a 600 s tool timeout.

Fixed. `build.sh` now cross-builds `linux/amd64` on the control node and exports
`dist/party-time-backend-amd64.tar.gz`; the playbook ships that tarball and
`docker load`s it. The compose task runs with `build: never` and the backend
source is no longer synced to the VM. Measured after the change: **build 56 s**
(full test suite included), **deploy 32 s**.

The rest of this hazard list still applies — in particular, a deploy can still
fail to apply for other reasons, so hazard 3's freshness check remains mandatory.

### 2. Never pipe `ansible-playbook` through `| tail`

> **Rule: never pipe a playbook run through `tail`, `head`, `grep`, or any other
> filter.**

Output buffers in the pipe. If the process is killed at a timeout, the buffered
output is **lost entirely**, leaving zero diagnostic information about how far the
deploy got.

Redirect to a log file and watch the file instead:

```bash
cd ~/Documents/Workspace/party-time
ANSIBLE_CONFIG=~/Documents/Workspace/homelab/ansible/ansible.cfg \
  nohup ansible-playbook deploy/party-time.yml \
  -e party_time_repo=$PWD \
  > /tmp/party-time-deploy.log 2>&1 &

tail -f /tmp/party-time-deploy.log
```

The log survives the process. The pipe does not.

### 3. A killed deploy can apply nothing while appearing to have run

A timed-out or killed playbook can leave the system completely untouched, with
output that looks like progress. **Never** conclude a deploy succeeded from the
playbook output alone.

Always verify with container age and image age:

```bash
ssh ubuntu@docker.local 'docker ps --format "{{.Names}} {{.Status}}"; docker images party-time-backend --format "{{.ID}} {{.CreatedSince}}"'
```

Ages measured in seconds/minutes mean it applied. Ages in hours mean it did not.

### 4. Timezone data missing from the production image (FIXED — do not reintroduce)

Documented so the fix is not accidentally reverted.

| | |
|---|---|
| **Symptom** | Every event create and update returned HTTP 400 with `invalid date format, expected YYYY-MM-DDTHH:MM`. All GET routes were unaffected. |
| **Cause** | The production image is Alpine with no `tzdata` package, and `CGO_ENABLED=0` rules out the system fallback. `time.LoadLocation("America/Chicago")` inside `parseCentralTime` therefore failed on **every** request. The handler maps **any** error from that function to the date-format message, so the error message pointed at the input instead of the environment. |
| **Fix** | `import _ "time/tzdata"` in `public_backend/main.go`, which embeds the IANA timezone database in the binary. The Dockerfile also installs the `tzdata` package as a second layer of defense. |
| **Why tests missed it** | The test suite **cannot** catch this. Dev hosts have system zoneinfo, so `LoadLocation` succeeds locally and in CI regardless of what the image contains. |

Do not remove the `_ "time/tzdata"` import while "cleaning up unused imports." It
is load-bearing and has no local symptom.

> **Debugging lesson:** an error message that names the *input* may actually be
> reporting an *environment* failure, when a handler collapses several error
> causes into one user-facing string.

### 5. SPA / API URL collision on `/invite/:id` and `/event/:id`

`/invite/:id` and `/event/:id` are **simultaneously** a React SPA route and a JSON
API endpoint at the identical URL. The path alone cannot distinguish them.

nginx (`deploy/nginx/public.conf` in this repo) splits on the `Accept` header
inside `location ~ ^/(invite|event|invites)`:

| `Accept` contains | nginx does | Client gets |
|---|---|---|
| `text/html` (browser navigation) | `rewrite ^ /index.html last` | The React bundle |
| anything else (SPA `fetch()`, `*/*`) | `proxy_pass http://public_backend` | JSON |

Two non-obvious constraints make this work:

**`Cache-Control: no-store` is required on BOTH branches.** `Vary: Accept` alone is
insufficient. A response cached *before* `Vary` existed has no Vary key, and gets
replayed for every `Accept` value indefinitely — so a browser navigation can be
served the JSON body forever. This actually happened and was hard to diagnose.
`no-store` makes the entire class of bug impossible rather than depending on every
cache in the path (browser, Cloudflare) honoring `Vary`.

**`rewrite ... last` re-enters location matching as a fresh internal request.**
`add_header` directives from the original location **do not carry over** to the
rewritten request. That is why there is an explicit block:

```nginx
location = /index.html {
    add_header Cache-Control "no-store" always;
}
```

It is scoped to the exact filename so hashed JS/CSS bundles served by `location /`
keep normal caching.

If you edit this vhost, verify **both** branches still return `Cache-Control:
no-store` using the two `curl` commands in [Verification](#verification).

### 6. mDNS is the #1 fragility

Four separate mDNS-related incidents occurred **in a single day**. Both nginx
upstreams point at `docker.local` by name, so anything that breaks name resolution
breaks the site.

| # | Symptom | Cause | Fix |
|---|---|---|---|
| a | nginx proxied to a dead IP; `docker.local` resolved to a stale `192.168.68.89` even after the VM moved | A hardcoded `192.168.68.89 docker.local` line in `/etc/hosts` on `nginx-cloudflared` masked mDNS entirely — `nsswitch.conf` lists `files` **before** `mdns4_minimal`. It was **not** Ansible-managed, so no playbook run would ever correct it | Remove the line from `/etc/hosts` |
| b | `docker.local` resolved to an IP nothing was listening on | The docker VM's DHCP lease moved `192.168.68.89` → `192.168.68.78` on 2026-07-27 | None needed once (a) was removed — mDNS tracks the new IP automatically |
| c | Docker VM unreachable by IPv4 for 17+ hours while containers kept running normally | Interface `enp6s18` failed with `Could not set NDisc address: Connection timed out` and lost its IPv4 address entirely; only IPv6 link-local remained | `sudo networkctl reconfigure enp6s18` |
| d | `nginx-cloudflared.local` and `nginx-internal.local` resolved inconsistently | Both nginx VMs logged avahi `Host name conflict, retrying with -2` and renamed themselves to `nginx-cloudflared-2.local` / `nginx-internal-2.local`. A network flap can make avahi see a delayed echo of its *own* probe and wrongly conclude the name is taken | `sudo systemctl restart avahi-daemon` on each affected VM |

Diagnostics for any suspected mDNS problem:

```bash
ssh ubuntu@nginx-cloudflared.local 'grep -n docker.local /etc/hosts'   # must print NOTHING
ssh ubuntu@nginx-cloudflared.local 'getent hosts docker.local'         # must be 192.168.68.78
ssh ubuntu@docker.local 'ip -4 addr show enp6s18'                      # must have an IPv4
ssh ubuntu@nginx-internal.local 'journalctl -u avahi-daemon --no-pager -n 50 | grep -i conflict'
```

> Check `/etc/hosts` **first**. It silently overrides everything else, and because
> it is not Ansible-managed, re-running playbooks will never surface or fix it.

### 7. nginx refuses to start if an upstream hostname is unresolvable

nginx resolves upstream hostnames **once, at config-parse time** — not per request.
If `docker.local` cannot be resolved at that moment, nginx **fails to start or
reload**.

| Check | Failing output |
|---|---|
| `systemctl is-active nginx` | `failed` |
| `sudo nginx -t` | `host not found in upstream "docker.local:8080"` |

The consequence: a **transient** DNS failure can leave nginx **permanently down**
until someone restarts it manually — long after resolution recovered.

Recovery, after confirming `docker.local` resolves again:

```bash
ssh ubuntu@nginx-cloudflared.local 'getent hosts docker.local && sudo nginx -t && sudo systemctl restart nginx'
```

### 8. Telling the layers apart from the error page

| Response | Produced by | Diagnosis |
|---|---|---|
| `content-type: text/plain`, body `error code: 502` | Cloudflare | The tunnel cannot reach nginx — check `cloudflared` and nginx on VM 201 |
| An HTML 502 page | nginx | nginx is up but cannot reach the backend — check `docker.local` resolution and the containers on VM 202 |

Read the `content-type` before doing anything else. It localizes the fault for free.

### 9. `<input type="datetime-local">` cannot be driven via browser automation

Chrome's `datetime-local` input **cannot** be set through CDP/automation. `fill`,
`fill_form`, `type_text`, and `press_key` **all silently report success while the
value stays empty.** There is no error to catch — the automation reports a clean
pass and the form submits blank.

You must use the native `HTMLInputElement` value setter plus a bubbling `input`
event so React's `onChange` fires:

```js
const input = document.querySelector('input[type="datetime-local"]');
const setter = Object.getOwnPropertyDescriptor(
  window.HTMLInputElement.prototype, 'value'
).set;
setter.call(input, '2026-08-15T18:00');
input.dispatchEvent(new Event('input', { bubbles: true }));
```

The `party-time-create-event` skill already handles this correctly — prefer it over
hand-rolling automation.

### 10. `/admin` is an API prefix, not a page

`GET /admin` returns **Gin's plain-text 404**. This is correct behavior, not a
broken deploy.

| | |
|---|---|
| Admin dashboard | `http://nginx-internal.local/` — **the root** |
| Admin SPA routes | `/`, `/contacts`, `/event/:id` |
| `/admin/*` | JSON API endpoints only, proxied to `party-time-admin` |

### 11. There is no delete-event route in the admin API

The admin API has no delete route for any resource. **Test events persist
indefinitely** until removed directly via `psql` — see
[Common Operations](#common-operations).

Keep this in mind when smoke-testing: every test event you create is permanent
until manually cleaned up, and the two existing `Test Event` rows are there for
exactly this reason.

### 12. `schema.sql` cannot migrate an existing database (RESOLVED — goose migrations adopted)

Historically every statement in `schema.sql` was `CREATE TABLE IF NOT EXISTS` /
`CREATE INDEX IF NOT EXISTS`, applied on every deploy. On a database where the
table already existed, the whole statement was skipped — an added column was
silently never created — and the test suite couldn't catch it because
`setup_test.go` rebuilt the schema from scratch every run.

Fixed. Schema is now goose migrations under `public_backend/migrations/`,
embedded in the binary (`//go:embed migrations/*.sql`, wired in
`public_backend/migrate.go`). A schema change is a new
`000NN_description.sql` file, never an edit to an existing one. Both
production and `setup_test.go` run the identical migration path via
`runMigrations`/`goose.Up`, so a green test suite now proves the migration
applies cleanly, not just that a from-scratch schema is correct.

Production applies migrations via a one-shot `migrate` service in
`docker-compose.prod.yml` (`command: ["migrate", "up"]`), gated on Postgres
being healthy and gating both backend containers via
`depends_on: migrate: condition: service_completed_successfully` — so
migrations always run exactly once, before either backend starts, on every
deploy.

**One-time step required before the first deploy carrying this change** — see
[One-time production baseline](#one-time-production-baseline-goose-adoption)
below. `00001_init.sql` is the old `schema.sql` verbatim, so it is all
`IF NOT EXISTS` and re-running it against production would *succeed silently*
rather than error — which is the danger. Goose would record version 1 as
applied without having applied it, and the baseline would look correct while
resting on an unverified assumption that the live tables match the migration.
Do the baseline step deliberately instead.

### 13. `run_local.sh` is broken (local development)

The script resets the database with `DROP SCHEMA public CASCADE`, but the schema
was renamed to `party_time`, so the reset drops nothing the app uses. The
separate session that loads `test_data.sql` then runs without `search_path` set
and fails with `ERROR: relation "contacts" does not exist`, and `set -e` aborts
the run. (The schema load is now `go run . migrate up` rather than a raw
`schema.sql` apply, but that changed nothing about this hazard.)

Verified by replaying the exact command sequence against a scratch Postgres
container.

Workaround and the proper fix are documented in the `develop-party-time` skill.
This affects local development only — deploys are unaffected, because the
playbook applies `schema.sql` directly and does not load `test_data.sql`.

### 14. New public API paths require an nginx change

The public vhost only proxies `location ~ ^/(invite|event|invites)`. Any other
public path falls through to `location /` and is answered with `index.html`, so
a new endpoint returns the SPA shell rather than JSON — the symptom is a
client-side JSON parse error, not a 404.

Adding a public route therefore requires editing `deploy/nginx/public.conf` in
this repo and applying it with
`ansible-playbook deploy/party-time.yml -e party_time_repo=$PWD --limit tag_nginx`
(with `ANSIBLE_CONFIG` set as in the Deploy Procedure above). Admin routes are
unaffected, since `location /admin` proxies that whole prefix.

---

## One-time production baseline (goose adoption)

**Do this exactly once, and BEFORE the first deploy that carries the goose
migrations change** (see hazard 12). Production already has every table
`00001_init.sql` would create, so goose must be told that migration is already
applied rather than being allowed to run it — running it for real would fail
on the first `CREATE TABLE` collision.

```bash
ssh ubuntu@docker.local
source /opt/party-time/.env.prod
docker exec party-time-db psql -U "$DBUSER" -d party_time -c \
  "CREATE TABLE IF NOT EXISTS party_time.goose_db_version (id integer PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY, version_id bigint NOT NULL, is_applied boolean NOT NULL, tstamp timestamp NOT NULL DEFAULT now());
   INSERT INTO party_time.goose_db_version (version_id, is_applied) VALUES (0, true), (1, true);"
```

> **Column layout verified against the installed goose v3 source**
> (`github.com/pressly/goose/v3@v3.27.3`, `internal/dialects/postgres.go`,
> `(*postgres).CreateTable`). Goose's own bootstrap DDL is:
> ```sql
> CREATE TABLE %s (
>     id integer PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY,
>     version_id bigint NOT NULL,
>     is_applied boolean NOT NULL,
>     tstamp timestamp NOT NULL DEFAULT now()
> )
> ```
> This differs from an earlier draft of this step in two ways: `id` is
> `integer ... GENERATED BY DEFAULT AS IDENTITY`, not `serial`, and `tstamp`
> is `NOT NULL`. The version numbers (`0` then `1`) are correct as drafted —
> goose inserts an implicit `version_id=0` baseline row itself on a fresh
> version table, and `00001_init.sql` is goose version `1`.

Verify before deploying — run the `migrate` compose service's `status`
variant, since `party-time-backend` lives in its own image, not in the
`party-time-db` container:

```bash
ssh ubuntu@docker.local 'cd /opt/party-time && \
  docker compose -f docker-compose.prod.yml run --rm migrate migrate status'
```

Expect `00001_init.sql` to show as already applied, and `migrate up` on the
next deploy to report no pending migrations rather than attempting to create
tables that already exist.

---

## Implemented Improvements

### Cross-build the backend locally instead of compiling in-guest

**Implemented 2026-07-31.** Recorded here because the reasoning matters if anyone
is tempted to reintroduce an in-guest build.

**Problem.** The deploy rebuilt the Go image inside the 2 vCPU / 2 GB / no-swap
docker VM, which dominated deploy time and drove load average to ~47 while
Postgres ran on the same host.

**Why in-guest builds were adopted.** The control node is `arm64`; the VMs are
`amd64`.

**Why that reason did not hold.** The backend is built with `CGO_ENABLED=0`. A
pure-Go binary cross-compiles for free — `GOOS=linux GOARCH=amd64` produces a
working `amd64` binary on the arm64 Mac with no emulation and no toolchain work.

**What changed:**

1. `public_backend/Dockerfile` pins the builder stage to
   `FROM --platform=$BUILDPLATFORM` and builds with `GOARCH=${TARGETARCH}`. This
   matters: without it, `buildx --platform linux/amd64` runs the whole builder
   stage under QEMU emulation, which is *slower* than the in-guest build it
   replaced. The point is to cross-compile natively, not to emulate.
2. `build.sh` runs `docker buildx build --platform linux/amd64 --load`, asserts
   the resulting image reports `amd64` (refusing to continue otherwise), and
   exports `dist/party-time-backend-amd64.tar.gz`.
3. `deploy/party-time.yml` ships that tarball, `docker load`s it, re-verifies the
   architecture on the VM, and removes the stale `public_backend/` source tree.
4. The compose task runs `build: never`, so a missing image fails loudly rather
   than silently attempting an in-guest build against sources that are no longer
   shipped.

**Measured effect.** Build 56 s including the full test suite; deploy 32 s.
Previously the deploy alone exceeded 600 s. The guest now only loads an image and
recreates containers, so it no longer starves Postgres of CPU and memory.

---

## Companion Skills

Operational skills that automate the procedures in this document.

| Skill | Location | Purpose |
|---|---|---|
| `develop-party-time` | `.claude/skills/` in this repo (`party-time`) | Implements features and fixes: layer conventions, the local dev loop, required test updates, and the cross-repo/schema traps |
| `deploy-party-time` | `.claude/skills/` in this repo (`party-time`) | Runs the build and deploy procedure |
| `diagnose-party-time` | `.claude/skills/` in this repo (`party-time`) | Works the layer-by-layer troubleshooting guide |
| `party-time-create-event` | `.claude/skills/` in this repo (`party-time`) | Creates an event through the admin UI, including the `datetime-local` field that normal automation cannot set (hazard 9) |
| `fix-homelab-mdns` | `.claude/skills/` in the `homelab` repo | Diagnoses and repairs the mDNS failure modes in hazard 6 — lives in `homelab` because it's generic homelab infrastructure, not party-time-specific |

The four `party-time` skills are symlinked into `~/.claude/skills/` by this
repo's `scripts/link-skills.sh`; `fix-homelab-mdns` is symlinked separately by
`homelab/scripts/link-skills.sh`. Symlinking makes every skill load regardless
of which repo is the working directory — deploys and builds both run from
`party-time` now, but the symlink still matters for skills invoked while
working from `homelab`. Re-run both scripts after a fresh clone.
