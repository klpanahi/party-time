---
name: develop-party-time
description: Implements features, changes, and bug fixes in the party-time application — Go/Gin backend plus the admin and invitee React SPAs. Use when the user wants to add or change an API endpoint, a page, a form, a database column, or app behaviour; asks to fix a bug in the backend or either UI; says "add a feature", "implement", "change how X works", "add a field", or describes something the app should start doing. Covers the local dev loop, the conventions each layer follows, the tests that must be updated, and the cross-repo and database traps that silently break a change that otherwise looks correct.
---

# Developing party-time

Three layers, one repo (`~/Documents/Workspace/party-time`), plus a **second repo**
that sometimes has to change with it. Read "Traps" before writing code — two of
them will let a change pass every local test and still fail in production.

For shipping the finished change, use the `deploy-party-time` skill. For
diagnosing something already broken, use `diagnose-party-time`.

## Layout

| Path | What it is |
|---|---|
| `public_backend/main.go` | Router, public route handlers, `Env` struct, CORS |
| `public_backend/admin_handlers.go` | All `/admin/*` handlers |
| `public_backend/structs.go` | Request, response, and DB types |
| `public_backend/helpers.go` | `getenv`, `loaddbconfig`, `parseCentralTime` |
| `public_backend/worker.go`, `sms.go` | Twilio outbox worker + `SMSSender` interface |
| `public_backend/*_test.go` | Integration tests (need Docker for Postgres) |
| `schema.sql` | Canonical schema. **Structural only** — no seed data |
| `test_data.sql` | Local dev seed data |
| `admin_ui/src/` | Admin SPA. `api.js` is the whole API client |
| `invitee_ui/src/` | Invitee SPA. `pages/InvitePage.jsx` is nearly all of it |
| `*/src/test/msw/handlers.js` | Mock API for the frontend tests |

Backend runs once as two containers: `ADMIN_ENABLED=false` (public, `:8080`) and
`ADMIN_ENABLED=true` (admin, `:8081`). Same binary, same image.

## Local development

```bash
cd ~/Documents/Workspace/party-time
./run_local.sh      # postgres + backend (air) + both UIs
```

Backend `:8080`, admin UI `:5173`, invitee UI `:5174`.

> **`run_local.sh` is currently broken.** It resets the database with
> `DROP SCHEMA public CASCADE`, but the schema was renamed to `party_time`.
> `schema.sql` sets `search_path` only for its own psql session, so the separate
> session that loads `test_data.sql` fails with
> `ERROR: relation "contacts" does not exist`, and `set -e` aborts the script.
> Verified by replaying the exact command sequence.
>
> Until it is fixed, reset manually:
> ```bash
> docker compose up -d
> docker compose exec -T postgres-db psql -U myuser -d party_time \
>   -c "DROP SCHEMA IF EXISTS party_time CASCADE;"
> docker compose exec -T postgres-db psql -U myuser -d party_time -f - < schema.sql
> docker compose exec -T postgres-db psql -U myuser -d party_time \
>   -c "SET search_path TO party_time;" -f - < test_data.sql
> ```
> The real fix is to drop `party_time` instead of `public` and to make
> `test_data.sql` schema-qualified or set `search_path` in the same session.
> Offer it; don't sneak it into an unrelated change.

Seeded texts are all terminal (`sent`/`failed`) with fake numbers, so the SMS
worker stays idle and never sends on startup.

## Recipes

### Add or change an admin endpoint

Admin is the easy path — everything lives under `/admin`, which nginx already
proxies wholesale.

1. Handler in `admin_handlers.go`, types in `structs.go`
2. Register in `main.go` inside the `admin` group
3. Test in `handlers_test.go` (call `cleanDB` first, like every other test)
4. Client function in `admin_ui/src/api.js`
5. **Add an MSW handler** in `admin_ui/src/test/msw/handlers.js` — otherwise
   unrelated component tests start failing on an unmocked request
6. Component work + its `.test.jsx`

### Add a public endpoint — requires an nginx vhost change (still in this repo)

The public nginx only proxies paths matching:

```
location ~ ^/(invite|event|invites)
```

Anything else — `/rsvp`, `/health`, `/api/whatever` — falls through to
`location /` and is answered with `index.html`. The SPA gets served instead of
your endpoint, so the symptom is a JSON parse error, not a 404.

A new public path therefore requires editing `deploy/nginx/public.conf` in
this repo and applying it:

```bash
cd ~/Documents/Workspace/party-time
ANSIBLE_CONFIG=~/Documents/Workspace/homelab/ansible/ansible.cfg \
  ansible-playbook deploy/party-time.yml -e party_time_repo=$PWD --limit tag_nginx     # seconds
```

Prefer adding under an existing prefix to avoid this entirely.

If the new path is *also* a React route, read the Accept-split comment in
`deploy/nginx/public.conf` first — a shared URL needs the `text/html` branch
and `Cache-Control: no-store` on both sides, or caches will serve one
representation for the other.

### Change the database schema

**There is no migration mechanism.** `schema.sql` is applied on every deploy,
but every statement is `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT
EXISTS`. On a database where the table already exists, the whole statement is
skipped — an added column is silently never created. Verified directly: adding a
column to `schema.sql` and re-applying it leaves the live table unchanged.

Tests do not catch this because `setup_test.go` drops and recreates the
`party_time` schema from scratch on every run, so the new column always exists
there.

To change the schema:

1. Edit `schema.sql` so fresh databases are correct
2. Write the matching `ALTER TABLE` and run it against production yourself:
   ```bash
   ssh ubuntu@docker.local 'source /opt/party-time/.env.prod; \
     docker exec party-time-db psql -U "$DBUSER" -d party_time \
     -c "ALTER TABLE party_time.events ADD COLUMN IF NOT EXISTS foo varchar;"'
   ```
3. Say explicitly in your summary that a manual ALTER was required and whether
   you ran it — this is the single easiest thing to forget and the failure is
   silent until a query hits the missing column

New tables are fine: `CREATE TABLE IF NOT EXISTS` creates those normally.

### Frontend-only change

Both SPAs are plain React 19 + Vite. All styling is in `src/App.css` with CSS
custom properties on `:root` — no CSS modules, no Tailwind, no component
libraries. Match the surrounding file; these are small, direct components with
no state management library.

## Conventions

**API calls are same-origin.** `admin_ui/src/api.js` uses `BASE = '/admin'` and
`invitee_ui` uses `BASE = ''`. Never reintroduce `http://localhost:8080` — it
breaks in production, where nginx serves the bundle and proxies the API on one
origin. The Vite dev servers proxy `/admin`, `/invite`, and `/event` to `:8080`
so dev matches prod.

**Dates.** Stored as `TIMESTAMPTZ`. The frontend sends a `datetime-local` string
and `parseCentralTime` parses it as `America/Chicago`. It accepts both
`YYYY-MM-DDTHH:MM` and `...:SS`. Both call sites map *any* error from it to
`"invalid date format"`, so that message does not necessarily mean the input was
malformed — see hazard 4 in AGENT.md.

**Never remove `import _ "time/tzdata"` from `main.go`.** The Alpine image has no
timezone database and `CGO_ENABLED=0` rules out the system fallback, so removing
it breaks every event create and update in production while all tests pass.

**SQL is schema-qualified or relies on `search_path=party_time`** set in the
connection string. Plain `public` will not find these tables.

**Admin routes require `ADMIN_ENABLED=true`.** There is no authentication — the
admin API is protected only by network isolation. Do not add anything to the
public backend that exposes admin data.

## Testing

```bash
cd public_backend && go test ./... -count=1   # needs Docker (Postgres)
cd admin_ui   && npx vitest run
cd invitee_ui && npx vitest run
```

Or everything at once, which is what the build does:

```bash
./build.sh      # tests, then builds both UIs and the backend image
```

`build.sh` is `set -euo pipefail` — any failing test aborts it, so a green
`build.sh` means the whole suite passed.

Backend tests are real integration tests against a live Postgres (`party_time_test`),
not mocks. They call `cleanDB` first. Frontend tests are Vitest + Testing Library
+ MSW, behaviour-focused rather than snapshot-based.

**Two things the test suite structurally cannot catch**, because tests run on a
dev host with a fresh database:

- anything depending on the container image (missing tzdata being the known case)
- schema drift on an existing database (see the migration trap above)

## Traps

| Trap | Consequence | Guard |
|---|---|---|
| New public path not in the nginx regex | SPA HTML served instead of the API; looks like a JSON parse error | Edit `deploy/nginx/public.conf` in this repo, or reuse an existing prefix |
| Schema change via `schema.sql` alone | Column silently never created in production | Write and run an explicit `ALTER TABLE` |
| Forgot the MSW handler | Unrelated frontend tests fail on an unmocked request | Update `test/msw/handlers.js` with every API change |
| Hardcoding `http://localhost:8080` | Works in dev, breaks in production | Keep API calls same-origin |
| Removing `time/tzdata` | Every event create/update 400s in production; tests still pass | Leave the blank import alone |
| `run_local.sh` | Currently aborts on the DB reset | Use the manual reset above |
| No delete-event route | Test events accumulate with no way to remove them via the UI | Clean up via psql |

## Done means

- [ ] `./build.sh` green (all three suites)
- [ ] Tests added for the new behaviour, not just existing ones passing
- [ ] MSW handlers updated if any endpoint changed
- [ ] Schema change accompanied by an explicit `ALTER`, and you said whether it ran
- [ ] New public path added to `deploy/nginx/public.conf` and applied, if applicable
- [ ] Deployed with `deploy-party-time`, and **verified against the running app** —
      a passing build is not evidence the change works in production
