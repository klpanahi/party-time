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

Runs the full test suite (Go backend tests require Docker for Postgres, frontend tests use vitest), then on green builds:
- `dist/admin-ui/` — built React admin UI
- `dist/invitee-ui/` — built React invitee UI
- `dist/party-time-backend-amd64.tar.gz` — cross-built `linux/amd64` Docker image, tarred for shipping

### Deploying nginx vhosts and the backend

Deployment is via the Ansible playbook `deploy/party-time.yml` in this repo — see
[`ops/AGENT.md`](ops/AGENT.md) for the full procedure, including the nginx vhost
bodies at `deploy/nginx/public.conf` and `deploy/nginx/admin.conf` (the single
source of truth for both edges), and the `ops/incident-log.md` /
`ops/healthcheck.sh` companions. Summary:

```bash
cd ~/Documents/Workspace/party-time
ANSIBLE_CONFIG=~/Documents/Workspace/homelab/ansible/ansible.cfg \
  ansible-playbook deploy/party-time.yml -e party_time_repo=$PWD
```

`.env.prod` must already exist on the backend (docker) VM — created from
`sample.local.env` with DB creds, Twilio vars, and `INVITEE_BASE_URL`. The
playbook checks for it and fails fast rather than creating or copying it.

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
