# Party Time Repo

## How To run this

This should all be done from the `public_backed` working directory

### Start the database

```
docker compose up
```

### Whipe database completly when shutting down

```
docker-compose down --volumes
```

### Start the Gin Server

```
export ADMIN_ENABLED="true" ##The app currently only runs in admin mode
air
```

Or use `./run_local.sh` from the repo root to start postgres + backend (air) + both UIs
together; pass `--no-reset` to restart without wiping the database. `./test.sh` runs the
full test suite (backend + both UIs) against a throwaway test Postgres, and `./e2e.sh`
smoke-tests the built UIs through a real nginx edge running the production vhost configs
(`deploy/nginx/public.conf` / `admin.conf`) — see `AGENT.md` for details.

This app will consist of 3 code bases

- An invite portal (party_invite)
  - This is the frontend that will be sent to guests to view and modify party invites
- An Admin Portal (not yet made)
  - This is where parties will be configured by the host
- A go api backend
  - This will have an admin and public socket to be used for externally and internaly facing traffic

## Production Deployment

The production stack runs on three Proxmox VMs:

- **Public nginx VM** — serves the invitee UI (static files) and proxies public API calls
- **Admin nginx VM** — serves the admin UI (static files) and proxies admin API calls; private network only
- **Backend VM** — runs three Docker containers via `docker-compose.prod.yml`: public backend (:8080), admin backend (:8081), and PostgreSQL

### Building artifacts

```bash
./build.sh
```

Runs `./test.sh` (Go backend tests require Docker for Postgres, frontend tests use vitest), then on green builds:
- `dist/admin-ui/` — built React admin UI
- `dist/invitee-ui/` — built React invitee UI
- `dist/party-time-backend-<sha>-amd64.tar.gz` — cross-built `linux/amd64` Docker image, tagged `party-time-backend:<sha>` and `:latest`, tarred for shipping
- `dist/manifest.json` — release provenance (`sha`, `branch`, `dirty`, `built_at`, `image_tag`, `tarball`), read by the deploy playbook to pin the image and gate the deploy

The git SHA is compiled into the backend via `-ldflags -X main.buildSHA=<sha>` and
exposed at `GET /healthz` on both containers (`{"ok":true,"sha":"<sha>"}`) — this is
how a deploy is verified, instead of guessing from container age.

### Deploying

`./deploy.sh` is the single post-merge command: it refuses a dirty tree or a
non-main branch (override with `--allow-dirty` / `--allow-branch`), refuses if
local `main` is behind `origin/main`, runs `./build.sh`, runs the playbook with
output redirected to a timestamped log in `dist/` (never piped through a
filter — a killed run must still leave diagnostics), checks the `PLAY RECAP`
for `failed=0`/`unreachable=0` on every host, verifies `/healthz` on both
edges reports the SHA just deployed, and runs the existing smoke checks. Use
`--nginx-only` for a config-only change to `deploy/nginx/*.conf` (limits the
playbook to the two nginx plays via `--tags nginx`).

```bash
cd ~/Documents/Workspace/party-time
./deploy.sh
```

Deployment itself is the Ansible playbook `deploy/party-time.yml` in this repo —
see [`ops/AGENT.md`](ops/AGENT.md) for the full procedure, including the nginx
vhost bodies at `deploy/nginx/public.conf` and `deploy/nginx/admin.conf` (the
single source of truth for both edges), and the `ops/incident-log.md` /
`ops/healthcheck.sh` companions. Direct invocation, if you need it:

```bash
cd ~/Documents/Workspace/party-time
ANSIBLE_CONFIG=~/Documents/Workspace/homelab/ansible/ansible.cfg \
  ansible-playbook deploy/party-time.yml -e party_time_repo=$PWD
```

The playbook reads `dist/manifest.json`, fails if it's missing (run `./build.sh`
first), fails if the build was `dirty` (override `-e allow_dirty=true`), fails
if it wasn't built from `branch: main` (override `-e allow_branch=true`), ships
the SHA-named tarball it names, and pins `PARTY_TIME_IMAGE=party-time-backend:<sha>`
for all three compose services (`public-backend`, `admin-backend`, `migrate`) so
none of them can run a different build than the others. It writes
`/opt/party-time/DEPLOYED` (sha, branch, timestamp, operator) after a successful
run.

`.env.prod` must already exist on the backend (docker) VM — created from
`sample.local.env` with DB creds, Twilio vars, and `INVITEE_BASE_URL`. The
playbook checks for it and fails fast rather than creating or copying it. (This
is unrelated to the `.env` file the playbook writes next to
`docker-compose.prod.yml` on the VM to pass `PARTY_TIME_IMAGE` to `docker
compose` — different file, never touches `.env.prod`.)

The schema is versioned as goose migrations in `public_backend/migrations/`,
embedded in the backend binary and applied by a one-shot `migrate` service in
`docker-compose.prod.yml` that runs before either backend starts — see
`ops/AGENT.md` for details, including the one-time production baseline step.

### Proxmox networking

Put the backend VM and admin nginx VM on a private bridge (`vmbr1`). Only the public nginx VM needs a public-facing interface (`vmbr0`). The admin VM should be reachable only via VPN or the private bridge.

## API Backend to do

- Create Database

### Tables

- Events Table: Contains the list of events that are scheduled
- Contacts Table: Contains the contacts of people I can invite
- Invites Table: What joins a contact to an event. This is how you invite someone
  - Includes the +1 data with the invite
- Sent Messages Table: The message history sent via twillio. Should be tied to a given individual and event
- Messages Table: Where message templates for a given message should be stored. This is where you'll see all event messages. Individual messages will be in the Sent Messages Table, which will tie to a person
