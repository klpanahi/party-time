---
name: deploy-party-time
description: Builds and deploys the party-time app to the homelab — runs the local test/build script on the Mac, then the Ansible deploy playbook that ships the backend image to the docker VM and the built UIs to the public and internal nginx VMs. Use when the user says "deploy party-time", "ship the app", "push the app to prod", "redeploy", "rebuild and deploy", "release party-time", "get it live", or has changed backend/frontend code and wants it running in the homelab. Also use for nginx-config-only changes, which take a different, much faster playbook path documented here.
---

# Deploy party-time

Two steps: **build on the Mac**, then **deploy with Ansible**. Never skip step 1 — the
playbook ships whatever is currently in the repo's `dist/` directories.

## Prerequisites

- Docker Desktop running on the Mac (`build.sh` starts a Postgres test container).
- `/opt/party-time/.env.prod` exists on the docker VM. Secrets live on the VM and are
  never shipped from the control node. The playbook **fails fast by design** if it is
  missing — **do not create or copy that file**; tell the user it is missing and stop.
- VMs already provisioned and `site.yml` applied.

Hosts (Ansible reaches them by IP via the Proxmox dynamic inventory):

| Host | IP | Role |
|---|---|---|
| nginx-cloudflared | 192.168.68.77 | public edge, invitee UI |
| docker | 192.168.68.78 | backend + Postgres |
| nginx-internal | 192.168.68.85 | admin UI |

## Which playbook do I need?

| Change | Command | Time |
|---|---|---|
| Backend Go code, admin_ui, invitee_ui — anything in the app | Full deploy: Step 1 + Step 2 below | ~90 s total |
| nginx config only (vhosts, headers, proxy rules) — public edge, edit `deploy/nginx/public.conf` | `cd ~/Documents/Workspace/party-time && ANSIBLE_CONFIG=~/Documents/Workspace/homelab/ansible/ansible.cfg ansible-playbook deploy/party-time.yml -e party_time_repo=$PWD --limit tag_nginx` | seconds |
| nginx config only — admin/internal, edit `deploy/nginx/admin.conf` | `cd ~/Documents/Workspace/party-time && ANSIBLE_CONFIG=~/Documents/Workspace/homelab/ansible/ansible.cfg ansible-playbook deploy/party-time.yml -e party_time_repo=$PWD --limit tag_nginx_internal` | seconds |

**Config-only nginx changes do NOT need the app deploy.** The full deploy re-runs the
entire test suite and ships a fresh image — pointless work for an nginx header change.

## Step 1 — Build (on the Mac)

```bash
cd ~/Documents/Workspace/party-time && ./build.sh
```

Runs Go backend tests (needs Docker for the Postgres test container), admin_ui vitest,
and invitee_ui vitest. On green it builds `admin_ui/dist`, `invitee_ui/dist`, and
**cross-builds the backend image for `linux/amd64`**, exporting
`dist/party-time-backend-amd64.tar.gz`.

The cross-build matters: the Mac is arm64 and the VMs are amd64. `build.sh` asserts the
built image actually reports `amd64` and refuses to continue otherwise, so a silently
wrong-architecture image cannot reach the VM. Takes ~56 s including the full test suite.

`build.sh` uses `set -euo pipefail` — it exits non-zero on **any** test failure.
**If it fails, stop.** Do not proceed to step 2, and do not "just deploy the UI anyway."
Report the failing test.

## Step 2 — Deploy (Ansible)

The playbook has three plays:

1. `tag_docker` — ship `party-time-backend-amd64.tar.gz`, `docker load` it, verify its
   architecture on the VM, sync compose + schema to `/opt/party-time`,
   `docker_compose_v2` with `build: never` / `recreate: always`, wait for Postgres,
   apply `schema.sql`.
2. `tag_nginx` — rsync `invitee_ui/dist` → `/var/www/invitee-ui`.
3. `tag_nginx_internal` — rsync `admin_ui/dist` → `/var/www/admin-ui`.

The playbook **fails fast if the image tarball is missing** — run `build.sh` first.
`build: never` means a missing image errors loudly instead of silently falling back to
an in-guest build.

Deploy takes ~32 s. It used to recompile Go inside the 2 vCPU / 2 GB / no-swap VM and
exceed a 600 s timeout; it no longer does. Even so, **run it in the background and watch
a log file** — the rule below is about not losing diagnostics, and it still applies.

> **NEVER pipe `ansible-playbook` through `| tail`, `| grep`, or anything else.**
> The output buffers and is **completely lost** if the process is killed at a timeout,
> leaving zero diagnostic information. This has already happened once and wasted
> significant time.

```bash
cd ~/Documents/Workspace/party-time
ANSIBLE_CONFIG=~/Documents/Workspace/homelab/ansible/ansible.cfg \
  ANSIBLE_FORCE_COLOR=0 nohup ansible-playbook deploy/party-time.yml \
  -e party_time_repo=$PWD \
  > /tmp/pt-deploy.log 2>&1 &
```

Then poll the log rather than blocking on the playbook:

```bash
tail -n 40 /tmp/pt-deploy.log
```

Re-check every 30–60s. Expect a long, silent gap at "Build and start Docker stack" —
that is normal, not a hang. Keep waiting; the log is your only diagnostic if it dies.

### PLAY RECAP is the authoritative result

```bash
grep -A 10 'PLAY RECAP' /tmp/pt-deploy.log
```

Require `failed=0` **and** `unreachable=0` for **every** host: docker,
nginx-cloudflared, nginx-internal. Anything else is a failed deploy.

## Verifying it actually applied

**A timed-out deploy can leave nothing applied while looking like it ran.**
**Never report success from the playbook exiting alone.** Always check freshness on the VM:

```bash
ssh ubuntu@docker.local 'docker ps --format "{{.Names}}\t{{.Status}}"; docker images party-time-backend --format "id={{.ID}} created={{.CreatedSince}}"'
```

- Containers should show **seconds or minutes** of uptime.
- The image should be **newly created**.

If they are days or weeks old, **the deploy did not apply.** Say so plainly, investigate,
and do not claim success.

## Smoke test

Ansible finishing is not the same as the app serving. Check both entry points:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://nginx-internal.local/                  # admin UI      → 200
curl -s -o /dev/null -w '%{http_code}\n' http://nginx-internal.local/admin/events      # admin API     → 200
curl -s -o /dev/null -w '%{http_code}\n' https://party-time.panahi-systems.com/        # public (CF)   → 200
```

If any of these fail, hand off to the **`diagnose-party-time`** skill rather than guessing.

## Troubleshooting pointers

- **`.env.prod` missing on the docker VM** — expected fail-fast. Do not create or copy it.
  Tell the user; the file is theirs to place.
- **mDNS names fail to resolve mid-deploy** (`docker.local`, `nginx-internal.local`) —
  known recurring fault; see the **`fix-homelab-mdns`** skill. Note that **Ansible is
  unaffected**: it connects by IP via the Proxmox dynamic inventory. Only nginx upstreams
  and your own `curl`/`ssh` by name break. Fall back to the IPs in the table above.
- **Playbook process died / log ends mid-task** — assume nothing applied, verify freshness
  on the VM (above), then re-run. Re-running is safe.
- **Smoke test non-200 but recap clean** — `diagnose-party-time`.

## Notes

- **Do not reintroduce an in-guest build.** The deploy used to compile Go on the docker VM
  and took minutes; it now ships a locally cross-built image and takes ~32 s. If a build
  problem tempts you toward `build: always`, fix the cross-build instead.
- **`--platform linux/amd64` alone is not enough.** The Dockerfile pins its builder stage
  to `FROM --platform=$BUILDPLATFORM` and compiles with `GOARCH=${TARGETARCH}`. Without
  that, buildx runs the entire builder stage under QEMU emulation, which is *slower* than
  the in-guest build it replaced. The goal is a native cross-compile, not emulation.
- **Architecture is verified twice** — `build.sh` checks the built image reports `amd64`,
  and the playbook re-checks after `docker load`. If either complains, do not work around
  it; a wrong-architecture image will start and then crash on the VM.
