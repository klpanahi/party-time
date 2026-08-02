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
- `dist/nginx-admin.conf` — nginx config for admin VM
- `dist/nginx-public.conf` — nginx config for public VM
- Docker image `party-time-backend:latest` (used for both backend containers)

### Deploying nginx VMs

1. Replace `BACKEND_VM_IP` in the nginx conf with the backend VM's internal IP
2. Copy the conf to `/etc/nginx/sites-available/party-time` and enable it
3. Copy the UI build to the nginx root (`/var/www/admin-ui/` or `/var/www/invitee-ui/`)

### Deploying the backend VM

1. Copy `docker-compose.prod.yml` and `schema.sql` to the VM
2. Create `.env.prod` (use `sample.local.env` as reference — set DB creds, Twilio vars, `INVITEE_BASE_URL`)
3. Run:
   ```bash
   docker compose -f docker-compose.prod.yml up -d
   ```

The schema is applied automatically on first boot via the Postgres `docker-entrypoint-initdb.d` mount. Subsequent restarts leave existing data intact.

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
