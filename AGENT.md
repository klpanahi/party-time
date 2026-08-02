# Party Time

Event invitation management system. An event coordinator creates events and invitees via the admin UI; invitees receive a text message with a personal link and RSVP through the invitee UI.

## Codemaps

Architecture, routes, schema, and dependency details are in `docs/CODEMAPS/`:

- `docs/CODEMAPS/architecture.md` — system diagram, service boundaries, event lifecycle
- `docs/CODEMAPS/backend.md` — all API routes with handler and query mapping
- `docs/CODEMAPS/frontend.md` — page trees, component breakdown, test inventory
- `docs/CODEMAPS/data.md` — full schema, relationships, migration history
- `docs/CODEMAPS/dependencies.md` — external libraries and infrastructure

## Repository Layout

```
party-time/
├── public_backend/     Go/Gin REST API — serves both UIs on :8080
├── admin_ui/           React admin portal — :5173 (ADMIN_ENABLED=true required)
├── invitee_ui/         React invitee portal — :5174
├── public_backend/migrations/  Goose migrations — canonical DB schema (embedded in the binary)
├── test_data.sql       Local dev seed data (loaded fresh by run_local.sh)
├── docker-compose.yml  Local PostgreSQL container
├── docker-compose.local-edge.yml  Prod-shaped local nginx edge, used by e2e.sh
├── run_local.sh        Starts all three services at once
├── test.sh             Backend + both UI test suites (used by build.sh)
├── e2e.sh              Smoke-tests the built UIs through the real nginx vhost configs
├── build.sh            Builds artifacts + dist/manifest.json (release provenance)
└── deploy.sh           Single post-merge deploy command — guards, build, ship, verify
```

## Running Locally

```bash
# Start everything (postgres + backend with air + both UIs):
./run_local.sh

# Restart without wiping the DB (keeps state you just created through the UI):
./run_local.sh --no-reset
```

Or individually:

```bash
# Database
docker compose up -d

# Backend (from public_backend/)
ADMIN_ENABLED=true go run .

# Admin UI (from admin_ui/)
npm run dev   # http://localhost:5173

# Invitee UI (from invitee_ui/)
npm run dev   # http://localhost:5174
```

`run_local.sh` waits for postgres to be ready, then **wipes the DB, runs `go run . migrate up`, and reloads `test_data.sql` on every startup** (so each run starts from the same known seed). The backend uses `air` for live reload.

All seeded texts are terminal (`sent`/`failed`) with fake numbers — there are no `pending`/`sending` rows, so the text worker stays idle on startup and never sends. To test live Twilio delivery, set `TWILIO_*` and queue a message from the admin UI yourself.

### Testing

```bash
./test.sh   # backend go test + admin_ui vitest + invitee_ui vitest, against a throwaway test Postgres
./e2e.sh    # builds both UIs if needed, then smoke-tests them through a real nginx edge
            # running the exact deploy/nginx/{public,admin}.conf vhost bodies — the only
            # local check that proves a route is actually reachable through nginx, not
            # silently swallowed by the SPA fallback
```

`build.sh` runs `test.sh` as its first step.

### Deploying

`./deploy.sh` is the single post-merge command — see the "Deploying" section
of [`README.md`](README.md) and the full procedure in
[`ops/AGENT.md`](ops/AGENT.md). It refuses a dirty tree or a non-main branch
before doing anything expensive, builds, ships the SHA-pinned image, verifies
the playbook's `PLAY RECAP`, and confirms `/healthz` on both edges reports the
SHA it just deployed.

`GET /healthz` is registered on the public route set (`main.go`), so it exists
on both the public and admin containers and both nginx vhosts
(`deploy/nginx/public.conf`, `deploy/nginx/admin.conf`) proxy it explicitly —
without an exact-match `location = /healthz` block it would otherwise be
swallowed by the SPA fallback, since it doesn't match either vhost's API
regex/prefix. It returns `{"ok":true,"sha":"<git sha>"}`, with the SHA
compiled in at build time via `-ldflags -X main.buildSHA=<sha>` (see
`public_backend/Dockerfile` and `build.sh`).

---

## Backend (`public_backend/`)

Go 1.25 / Gin v1.12. Single binary on `:8080`. Admin routes are gated by `ADMIN_ENABLED=true`.

### Key Files

| File | Purpose |
|------|---------|
| `main.go` | Router setup, CORS, public route handlers, `Env` struct |
| `admin_handlers.go` | All `/admin/*` handlers + `buildInviteMessage()` |
| `structs.go` | All request, response, and DB types |
| `helpers.go` | `getenv()`, `loaddbconfig()`, `parseCentralTime()` |
| `setup_test.go` | Test DB setup — runs the embedded goose migrations via `runMigrations` (`migrate.go`) |
| `handlers_test.go` | Integration tests (all tests call `cleanDB` before running) |

### Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `ADMIN_ENABLED` | `false` | `"true"` to expose `/admin/*` routes |
| `INVITEE_BASE_URL` | `http://localhost:5174` | Base URL prepended to invite links |
| `DBUSER` | `myuser` | PostgreSQL username |
| `DBPASS` | `mypassword` | PostgreSQL password |
| `DBHOST` | `127.0.0.1` | Database host |
| `DBPORT` | `5432` | PostgreSQL port |
| `TWILIO_ACCOUNT_SID` | _(unset)_ | Twilio Account SID — enables the text worker |
| `TWILIO_AUTH_TOKEN` | _(unset)_ | Twilio Auth Token |
| `TWILIO_FROM_NUMBER` | _(unset)_ | Twilio sender (E.164 number or Messaging Service SID) |
| `TEXT_WORKER_INTERVAL` | `3s` | How often the worker polls for pending texts (`time.ParseDuration`) |
| `TEXT_WORKER_RATE_MS` | `1100` | Delay between sends, ms — keeps under the trial ~1 MPS long-code limit |

Database name is hardcoded as `party_time`. Test DB is `party_time_test`.

All three `TWILIO_*` vars must be set for SMS to send; if any is missing the text worker is disabled and texts stay `pending` (handy for local dev and tests).

### Public Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/invites` | List all raw invite records |
| GET | `/invite/:id` | Enriched invite + co-invitees; stamps `opened_at` on first call |
| PUT | `/invite/:id` | Update RSVP status and `additional_guests` |
| GET | `/event/:id` | Fetch a single event by ID |

`GET /invite/:id` returns `InvitePageResponse`: all invite/contact/event fields plus `co_invitees` (other invitees on the same event, ordered Accepted → Tentative → No Response → Declined, with first name and last initial only).

`PUT /invite/:id` body: `{ "rsvp_status": "Accepted"|"Tentative"|"Declined"|"No Response", "additional_guests": N }`

### Admin Routes (`ADMIN_ENABLED=true`, prefix `/admin`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/contacts` | List all contacts ordered by name |
| POST | `/admin/contacts` | Create a contact |
| PUT | `/admin/contacts/:id` | Update a contact |
| GET | `/admin/events` | List events with aggregated RSVP counts |
| POST | `/admin/events` | Create an event (status defaults to `draft`) |
| GET | `/admin/events/:id` | Event + invitee list with `invite_url` and `opened_at` |
| PUT | `/admin/events/:id` | Update event fields |
| POST | `/admin/events/:id/invites` | Add invitee — existing contact or new |
| POST | `/admin/events/:id/messages` | Queue message as pending texts to non-declined invitees |
| GET | `/admin/events/:id/texts` | List queued/sent texts for an event (incl. `status`, `error`, `provider_sid`, `sent_at`) |
| POST | `/admin/events/:id/launch` | Transition event `draft → launched`, queue invite texts |
| POST | `/admin/texts/:id/resend` | Requeue a `failed` text (`failed → pending`); 409 if not failed |

`POST /admin/events/:id/invites` accepts either `{ "contact_id": N }` or `{ "first_name", "last_name", "phone_number" }` (upserts contact by phone). If the event is already launched, an invite text is queued immediately for the new invitee.

`POST /admin/events/:id/launch` requires at least one invitee; inserts a pending text per invitee and sets `events.status = 'launched'`. Returns 409 if already launched.

### Text Delivery (SMS via Twilio)

The `texts` table is a durable outbox/queue. Admin handlers (`launch`, `messages`, late
`invites`) insert rows as `status = 'pending'` and return immediately — they never call
Twilio inline. A background worker (`worker.go`, started from `main.go` when `TWILIO_*` is
configured) drains the queue:

- **Claim:** `FOR UPDATE SKIP LOCKED` moves a batch (≤10) from `pending → sending`, so
  restarts/multiple workers never double-claim a row.
- **Send:** one Twilio Create-Message call per recipient via the `SMSSender` interface
  (`sms.go`). Success → `sent` (records `provider_sid`, `sent_at`). Error → `failed`
  (records `error`). **Fail-fast:** one attempt, no auto-retry; resend manually.
- **Rate limit:** `TEXT_WORKER_RATE_MS` between sends to respect the ~1 MPS trial limit.
- **Crash recovery:** on startup, any leftover `sending` rows are marked `failed`
  (`error = 'interrupted (process restart)'`) — at-most-once, since we can't tell whether
  Twilio accepted them.

**Status lifecycle:** `pending → sending → sent` (or `→ failed`, then `→ pending` again via
resend). Confirmation is at Twilio-acceptance level (queued/sent); carrier delivery receipts
are not tracked. **Free-trial caveats:** ≤50 msgs/day and recipients must be verified in the
Twilio console.

### Date Handling

All event dates are stored as `TIMESTAMPTZ`. `parseCentralTime()` in `helpers.go` parses the `datetime-local` string (`"2006-01-02T15:04"`) from the frontend as `America/Chicago` before storing.

### CORS

Allows `http://localhost:5173` (admin UI) and `http://localhost:5174` (invitee UI).

---

## Admin UI (`admin_ui/`, port 5173)

React 19 + Vite. Not publicly accessible — requires the backend admin pod.

### Pages

| Path | Page | Description |
|------|------|-------------|
| `/` | EventSummary | Events split into Upcoming / Past; create event modal |
| `/event/:id` | EventDetails | Edit event, manage invitees, send messages, view texts log |
| `/contacts` | Contacts | Contact book — view, add, edit |

### Key Behaviours

**EventSummary (`/`)**
- Fetches `GET /admin/events` — events with aggregated RSVP counts.
- Splits into Upcoming / Past by comparing `event.date` to now.
- "Create Event" modal navigates to the new event's detail page on success.

**EventDetails (`/event/:id`)**
- **Auto-save:** all event fields debounce 800 ms then call `PUT /admin/events/:id`. On load, `event.date` is normalised to `YYYY-MM-DDTHH:MM` via `toDatetimeLocal()` so non-date field changes still send a valid date string to `parseCentralTime()`.
- **Tabs:** Invitees | Messages
- **Invitees tab:** table with Name, Phone, RSVP badge, +Guests, Opened timestamp, and an Invite Link copy button.
  - **Add Invitee modal** — two tabs: *From Contacts* (search, click to invite) and *New Contact* (upserts by phone number).
  - **Send a Message** section: queues a broadcast to all non-declined invitees; backend appends each recipient's personal RSVP link automatically.
  - **"Notify invitees of changes"** button (launched events only): pre-fills the message textarea with a stock update notice and scrolls/focuses to it.
- **Messages tab:** chronological log of all queued/sent texts with expandable content rows.
- **Launch Event** button (draft events): confirmation modal → `POST /admin/events/:id/launch`.
- Invitees are ordered: Accepted → Tentative → No Response → Declined.

**Contacts (`/contacts`)**
- "+ Add Contact" and per-row Edit button both open a modal form that creates or updates via the contacts API.

### API Client (`src/api.js`)

All calls target `http://localhost:8080/admin`. Throws on non-2xx.

| Export | Method | Path |
|--------|--------|------|
| `getContacts` | GET | `/contacts` |
| `createContact` | POST | `/contacts` |
| `updateContact` | PUT | `/contacts/:id` |
| `getEvents` | GET | `/events` |
| `getEvent` | GET | `/events/:id` |
| `createEvent` | POST | `/events` |
| `updateEvent` | PUT | `/events/:id` |
| `addInvitee` | POST | `/events/:id/invites` |
| `sendMessage` | POST | `/events/:id/messages` |
| `getTexts` | GET | `/events/:id/texts` |
| `launchEvent` | POST | `/events/:id/launch` |

### Date Utilities (`src/dateUtils.js`)

| Export | Purpose |
|--------|---------|
| `toDatetimeLocal` | Converts ISO timestamp to `YYYY-MM-DDTHH:MM` for `datetime-local` inputs |
| `formatDateShort` | Formats ISO timestamp as `"Mar 7, 2025, 6:00 PM"` for table display |

### Testing

Vitest + Testing Library + MSW. Run with `npm test` or `npm run test:coverage`.

- `src/test/setup.js` — global jest-dom matchers
- `src/test/msw/handlers.js` — MSW mock handlers for all admin API routes
- `src/pages/EventSummary.test.jsx`, `EventDetails.test.jsx`, `Contacts.test.jsx`
- `src/dateUtils.test.js`

### Styling

All styles in `src/App.css`. CSS custom properties on `:root`. No CSS modules, no Tailwind. RSVP badge colours: Accepted = green, Tentative = amber, Declined = red, No Response = grey.

---

## Invitee UI (`invitee_ui/`, port 5174)

React 19 + Vite. Public-facing, mobile-first. Invitees arrive via a text message link (`/invite/:uuid`). No authentication.

### Pages

| Path | Page | Description |
|------|------|-------------|
| `/invite/:id` | InvitePage | The full invite experience |
| `*` | NotFound | Catch-all for invalid routes |

### Invite Page Behaviour

On mount, `GET /invite/:id` returns everything needed in one response.

- **Event info:** name, date (formatted), location, description
- **RSVP buttons:** Attending / Maybe / Can't make it — each tap immediately calls `PUT /invite/:id`
- **Plus-ones counter:** +/− shown only when `plus_ones_allowed` is true and the invitee hasn't declined; each tap saves immediately
- **Past event lock:** if `event_date` is in the past, controls are hidden and replaced with a notice; event details still display
- **Co-invitees list:** other invitees shown as first name + last initial, RSVP pill, and guest count bubble
- **Save status:** "Saving…" / "Saved ✓" / inline error

`GET /invite/:id` has a side-effect: the backend stamps `opened_at` on the first call, which the admin UI surfaces as the "Opened" timestamp.

### Design Notes

- Mobile-first (`100dvh` layout, large touch targets)
- All styles in `src/App.css`; no CSS modules or utility frameworks
- Invite IDs are UUIDs — links cannot be guessed

### Testing

Vitest + Testing Library + MSW. Run with `npm test` from `invitee_ui/`.

- `src/pages/InvitePage.test.jsx`

---

## Known Limitations

- Texts are queued in the `texts` table but no worker or Twilio integration sends them yet
- No authentication on admin routes (relies on network-level isolation)
- Backend port is hardcoded to `:8080`
