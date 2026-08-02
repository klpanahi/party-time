---
name: deploy-party-time
description: Deploys the party-time app to the homelab with ./deploy.sh, which builds locally, runs the Ansible playbook that ships the backend image to the docker VM and the built UIs to the public and internal nginx VMs, then verifies the live SHA matches what was built. Use when the user says "deploy party-time", "push the app to prod", "redeploy", "rebuild and deploy", "release party-time", "get it live", or has merged a change and wants it running in the homelab. Also covers the --nginx-only fast path for vhost-only changes and what each deploy guard refuses on. Not for opening a PR — that is ship-party-time.
---

# Deploy party-time

One command: `./deploy.sh`, run from `~/Documents/Workspace/party-time` on
`main`. It wraps the build, the playbook, and verification, and refuses to
run under conditions that would make "success" a lie.

## Prerequisites

- Docker Desktop running on the Mac (`build.sh` starts a Postgres test container).
- `/opt/party-time/.env.prod` exists on the docker VM. Secrets live on the VM and are
  never shipped from the control node. The playbook **fails fast by design** if it is
  missing — **do not create or copy that file**; tell the user it is missing and stop.
- VMs already provisioned and `homelab/ansible/site.yml` applied.
- **First deploy carrying the goose migrations change only**: the one-time
  production baseline in `ops/AGENT.md` ("One-time production baseline (goose
  adoption)") must be run once, by hand, before `deploy.sh` — it has **not**
  been run yet as of this writing. Without it, the `migrate` service will try
  to `CREATE TABLE` on tables that already exist and fail. Check whether it's
  been done before running a normal deploy after this change lands.

Hosts (Ansible reaches them by IP via the Proxmox dynamic inventory):

| Host | IP | Role |
|---|---|---|
| nginx-cloudflared | 192.168.68.77 | public edge, invitee UI |
| docker | 192.168.68.78 | backend + Postgres |
| nginx-internal | 192.168.68.85 | admin UI |

## The command

```bash
cd ~/Documents/Workspace/party-time
./deploy.sh                 # normal deploy
./deploy.sh --nginx-only    # fast path for an nginx-vhost-only change
./deploy.sh --allow-dirty   # override the dirty-tree refusal
./deploy.sh --allow-branch  # override the non-main-branch refusal
```

### What it does, in order

1. **Refuses a dirty tree** (`git status --porcelain` non-empty) unless
   `--allow-dirty`. This check runs before anything expensive.
2. **Refuses a non-`main` branch** unless `--allow-branch`.
3. **Refuses if local `main` is behind `origin/main`** — `git fetch origin`,
   then compares SHAs and the merge-base. Tells you to `git pull` instead of
   overriding.
4. **Builds** — `./build.sh` (skipped entirely with `--nginx-only`).
5. **Deploys** — runs `deploy/party-time.yml`, output redirected to a
   timestamped log under `dist/`, **never** through a filter (see below).
   `--nginx-only` adds `--tags nginx`, scoping the playbook to the two nginx
   plays; it does not touch the backend image.
6. **Checks the `PLAY RECAP`** — requires every expected host (`docker`,
   `nginx-cloudflared`, `nginx-internal`, or just the two nginx hosts for
   `--nginx-only`) to actually appear in the recap with `failed=0` and
   `unreachable=0`. An ansible-playbook that exits 0 because the dynamic
   inventory failed to parse and matched no hosts would otherwise look like a
   successful no-op deploy — this has happened before, so the script checks
   for each expected host by name, not just "recap exists."
7. **Verifies `/healthz` on both edges reports the SHA just built** (skipped
   for `--nginx-only`, which never touches the backend). `GET /healthz`
   returns `{"ok":true,"sha":"<sha>"}`, with the SHA compiled in via
   `-ldflags -X main.buildSHA=<sha>`. This proves the *running* code matches
   what was just deployed, not just that the playbook exited 0.
8. **Runs smoke checks** — admin UI, admin API, public site all expected
   200.

Any refusal or failed check exits non-zero with a message explaining what to
do; `deploy.sh` never reports success from the playbook exiting alone.

### `--nginx-only` fast path

For a change to `deploy/nginx/public.conf` or `deploy/nginx/admin.conf` only.
It skips `build.sh` entirely, so it **requires `invitee_ui/dist` and
`admin_ui/dist` to already exist** — it refuses with a clear message if
either is missing, rather than shipping stale or absent web roots. Run
`./build.sh` once first if you haven't built recently.

## Refusals and how to override

| Refusal | Meaning | Override |
|---|---|---|
| Dirty working tree | Uncommitted changes would be baked into the build's provenance | `--allow-dirty` |
| Not on `main` | Deploying a feature branch is almost always a mistake | `--allow-branch` |
| Local `main` behind `origin/main` | You'd deploy stale code | `git pull`, no override |
| `dist/manifest.json` missing (from `build.sh`/playbook) | Deploy needs the build's provenance | Run `./build.sh` |
| `--nginx-only` but UI dists missing | Nothing to rsync | Run `./build.sh` once |
| `PLAY RECAP` missing an expected host | Nothing was actually deployed to that host | Check the log — usually a dynamic-inventory parse failure |
| `/healthz` SHA mismatch after deploy | The deployed binary isn't running the SHA just built | Investigate — do not re-run blindly |

## Never pipe `ansible-playbook` through a filter

> **Rule: never pipe `ansible-playbook` through `tail`, `head`, `grep`, or any
> other filter.**

Output buffers in the pipe. If the process is killed at a timeout, the
buffered output is **lost entirely**, leaving zero diagnostic information
about how far the deploy got. `deploy.sh` redirects to
`dist/deploy-<timestamp>.log` instead — the log survives the process even if
it's killed; a pipe does not. If you ever run the playbook by hand instead of
through `deploy.sh`, follow the same rule.

## Where the log goes

`dist/deploy-<UTC timestamp>.log`, printed at the start of the run so it's
findable even if the run is later killed. `grep -A 10 'PLAY RECAP'` on it is
the authoritative result if you need to re-check by hand.

## Timing reality

Build ~56 s (full test suite included), deploy ~32 s. It used to recompile Go
inside the 2 vCPU / 2 GB / no-swap docker VM and routinely exceeded a 600 s
timeout — that's fixed (`build.sh` cross-builds `linux/amd64` locally and
ships a tarball). Do not reintroduce an in-guest build.

## Verifying it actually applied

`deploy.sh` does this for you (steps 6–8 above), but if you ever need to
check by hand — a killed or timed-out deploy can leave nothing applied while
looking like it ran:

```bash
ssh ubuntu@docker.local 'docker ps --format "{{.Names}}\t{{.Status}}"; docker images party-time-backend --format "id={{.ID}} created={{.CreatedSince}}"'
```

Containers should show seconds/minutes of uptime and a newly created image.
Hours or days old means the deploy did not apply.

## Troubleshooting pointers

- **`.env.prod` missing on the docker VM** — expected fail-fast. Do not
  create or copy it. Tell the user; the file is theirs to place.
- **mDNS names fail to resolve mid-deploy** (`docker.local`,
  `nginx-internal.local`) — known recurring fault; see the
  **`fix-homelab-mdns`** skill. Ansible itself is unaffected (it connects by
  IP via the Proxmox dynamic inventory); only nginx upstreams and your own
  `curl`/`ssh` by name break.
- **Playbook process died / log ends mid-task** — assume nothing applied,
  verify freshness on the VM (above), then re-run `./deploy.sh`. Re-running
  is safe.
- **Smoke check or `/healthz` verification fails but recap is clean** — hand
  off to `diagnose-party-time`.

## Notes

- **Do not reintroduce an in-guest build.** `build: never` in
  `docker-compose.prod.yml` means a missing image fails loudly on the VM
  instead of silently falling back to an in-guest compile.
- **`--platform linux/amd64` alone is not enough** for the cross-build. The
  Dockerfile pins its builder stage to `FROM --platform=$BUILDPLATFORM` and
  compiles with `GOARCH=${TARGETARCH}`. Without that, buildx runs the whole
  builder stage under QEMU emulation, which is *slower* than the in-guest
  build it replaced.
- Full manual procedure, hazards, and the one-time goose baseline step are in
  `ops/AGENT.md` — this skill is the fast path through it.
