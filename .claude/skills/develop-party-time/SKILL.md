---
name: develop-party-time
description: Implements features, changes, and bug fixes in the party-time application — Go/Gin backend plus the admin and invitee React SPAs. Use when the user wants to add or change an API endpoint, a page, a form, a database column, or app behaviour; asks to fix a bug in the backend or either UI; says "add a feature", "implement", "change how X works", "add a field", or describes something the app should start doing. Covers the local dev loop, the conventions each layer follows, the tests that must be updated, and the cross-repo and database traps that silently break a change that otherwise looks correct.
---

# Developing party-time

Three layers, one repo (`~/Documents/Workspace/party-time`). Deploy, nginx vhosts,
and ops docs live here too now — one feature is one branch is one PR. Read
"Traps" before writing code — the route-duplication trap in particular will
let a change pass every local test and still be untested in CI.

To ship the finished change, use the `ship-party-time` skill (branch, tests,
PR). To actually deploy after merge, use `deploy-party-time`. For diagnosing
something already broken, use `diagnose-party-time`.

## Layout

| Path | What it is |
|---|---|
| `public_backend/main.go` | Router, public route handlers, `Env` struct, CORS |
| `public_backend/admin_handlers.go` | All `/admin/*` handlers |
| `public_backend/structs.go` | Request, response, and DB types |
| `public_backend/helpers.go` | `getenv`, `loaddbconfig`, `parseCentralTime` |
| `public_backend/worker.go`, `sms.go` | Twilio outbox worker + `SMSSender` interface |
| `public_backend/*_test.go` | Integration tests (need Docker for Postgres) |
| `public_backend/setup_test.go` | `newRouter()` — a **second**, hand-maintained route registration used only by tests |
| `public_backend/migrations/*.sql` | Goose migrations — canonical schema, embedded in the binary |
| `public_backend/migrate.go` | Wires goose to the embedded migrations; `runMigrations` is shared by prod and tests |
| `test_data.sql` | Local dev seed data |
| `admin_ui/src/` | Admin SPA. `api.js` is the whole API client |
| `invitee_ui/src/` | Invitee SPA. `pages/InvitePage.jsx` is nearly all of it |
| `*/src/test/msw/handlers.js` | Mock API for the frontend tests |
| `deploy/nginx/public.conf`, `deploy/nginx/admin.conf` | nginx vhost bodies — single source of truth for both edges, in this repo |
| `deploy/party-time.yml` | Deploy playbook |
| `ops/AGENT.md` | Full operations manual this skill is a companion to |

Backend runs once as two containers: `ADMIN_ENABLED=false` (public, `:8080`) and
`ADMIN_ENABLED=true` (admin, `:8081`). Same binary, same image.

## Local development

```bash
cd ~/Documents/Workspace/party-time
./run_local.sh              # postgres + backend (air) + both UIs, DB reset + reseed every run
./run_local.sh --no-reset   # restart without wiping state you just created through the UI
```

Backend `:8080`, admin UI `:5173`, invitee UI `:5174`. Seeded texts are all
terminal (`sent`/`failed`) with fake numbers, so the SMS worker stays idle and
never sends on startup.

## Recipes

Every recipe below ends the same way: hand off to `ship-party-time` for the
branch → `test.sh` → `e2e.sh` → PR sequence.

### Add or change an admin endpoint

Admin is the easy path — everything lives under `/admin`, which nginx already
proxies wholesale.

1. Handler in `admin_handlers.go`, types in `structs.go`
2. Register in `main.go` inside the `admin` group **and** in `setup_test.go`'s
   `newRouter()` — see the route-duplication trap below
3. Test in `handlers_test.go` (call `cleanDB` first, like every other test)
4. Client function in `admin_ui/src/api.js`
5. **Add an MSW handler** in `admin_ui/src/test/msw/handlers.js` — otherwise
   unrelated component tests start failing on an unmocked request
6. Component work + its `.test.jsx`
7. Hand off to `ship-party-time`

### Add a public endpoint — requires an nginx vhost change (still in this repo)

The public nginx only proxies paths matching:

```
location ~ ^/(invite|event|invites)
```

plus an exact-match `location = /healthz`. Anything else — `/rsvp`,
`/api/whatever` — falls through to `location /` and is answered with
`index.html` (a 200 with SPA HTML, which looks like a client-side JSON parse
error, not a 404).

A new public path therefore requires editing `deploy/nginx/public.conf` in
this repo, in the same PR as the Go change. `e2e.sh` proves the route is
actually reachable through nginx — it discovers every registered public route
straight from `main.go` and asserts none of them fall back to the SPA shell,
so a route you forgot to add to the regex fails `e2e.sh` rather than surfacing
as a production bug.

If the new path is *also* a React route, read the Accept-split comment in
`deploy/nginx/public.conf` first — a shared URL needs the `text/html` branch
and `Cache-Control: no-store` on both sides, or caches will serve one
representation for the other.

Prefer adding under an existing prefix (`/invite`, `/event`, `/invites`) to
avoid an nginx change entirely.

### Change the database schema

Schema changes are goose migrations in `public_backend/migrations/`, embedded
in the binary via `//go:embed`. Add a new file, never edit an existing one:

1. Create `public_backend/migrations/000NN_description.sql` with `-- +goose Up`
   / `-- +goose Down` sections. Table-qualify everything under `party_time.`.
2. `setup_test.go` runs the exact same migration path (`runMigrations` in
   `migrate.go`) that production does, so a passing test suite proves the
   migration applies cleanly against a real database, not just that a
   from-scratch schema is correct.
3. Deploys run a one-shot `migrate` compose service
   (`docker-compose.prod.yml`, `command: ["migrate", "up"]`) before either
   backend container starts — no manual `ALTER TABLE` against prod.
4. If this is the **first** migrations-carrying deploy since goose was
   adopted, production needs the one-time baseline step in `ops/AGENT.md`
   (goose must be told `00001_init.sql` is already applied, since production
   already has those tables). It has not been run yet as of this writing —
   check with the operator before the first such deploy.

New tables and altered columns both go through this path — there is no
special case.

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
malformed — see hazard 4 in `ops/AGENT.md`.

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
./test.sh      # backend go test + admin_ui vitest + invitee_ui vitest, against a throwaway test Postgres
./e2e.sh       # builds both UIs if needed, then proves every route through a real nginx edge
               # running the exact deploy/nginx/{public,admin}.conf vhost bodies
```

Or individually:

```bash
cd public_backend && go test ./... -count=1   # needs Docker (Postgres)
cd admin_ui   && npx vitest run
cd invitee_ui && npx vitest run
```

`./build.sh` runs `./test.sh` as its first step, then builds both UI dists and
cross-builds the backend image. `test.sh` and `build.sh` are both
`set -euo pipefail` — any failing test aborts them.

Backend tests are real integration tests against a live Postgres (`party_time_test`),
not mocks. They call `cleanDB` first. Frontend tests are Vitest + Testing Library
+ MSW, behaviour-focused rather than snapshot-based.

**One thing the test suite structurally cannot catch**: anything depending on
the container image (missing tzdata being the known case) — dev hosts have
system zoneinfo regardless of what the image contains. Schema drift on an
existing database is no longer in this category: tests exercise the same
goose migration path production uses.

## Traps

| Trap | Consequence | Guard |
|---|---|---|
| Route added to `main.go` but not `setup_test.go`'s `newRouter()` | The route is live in production but has **zero** test coverage — the test suite silently never exercises it | Add every new route in both files; `go test` won't tell you it's missing |
| New public path not in the nginx regex | SPA HTML served instead of the API; looks like a JSON parse error, not a 404 | Edit `deploy/nginx/public.conf`; `e2e.sh` catches this automatically |
| Editing `00001_init.sql` instead of adding a new migration | goose sees the checksum change and refuses to apply, or the change never reaches an already-migrated database | Always add a new `000NN_*.sql` migration file |
| Forgot the MSW handler | Unrelated frontend tests fail on an unmocked request | Update `test/msw/handlers.js` with every API change |
| Hardcoding `http://localhost:8080` | Works in dev, breaks in production | Keep API calls same-origin |
| Removing `time/tzdata` | Every event create/update 400s in production; tests still pass | Leave the blank import alone |
| No delete-event route | Test events accumulate with no way to remove them via the UI | Clean up via psql |

## Done means

- [ ] `./test.sh` green (all three suites)
- [ ] `./e2e.sh` green if a route or nginx vhost changed
- [ ] Tests added for the new behaviour, not just existing ones passing
- [ ] New/changed route registered in both `main.go` and `setup_test.go`'s `newRouter()`
- [ ] MSW handlers updated if any endpoint changed
- [ ] Schema change added as a new goose migration file, not an edit to an existing one
- [ ] New public path added to `deploy/nginx/public.conf`, if applicable
- [ ] Shipped via `ship-party-time` (branch, tests, PR), then deployed and
      **verified against the running app** via `deploy-party-time` — a
      passing build is not evidence the change works in production
