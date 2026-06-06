# Party Time — Public Backend

## Project Overview

REST API backend for an event invitation management system. Built in Go with the Gin framework and PostgreSQL. Serves two roles depending on the `ADMIN_ENABLED` env var:

- **Public pod** (`ADMIN_ENABLED=false`) — exposes only the public routes; the only write operation allowed is updating an invite's RSVP status.
- **Admin pod** (`ADMIN_ENABLED=true`) — additionally exposes all `/admin/*` routes for managing events, contacts, and invitees.

Both pods run the same binary on `:8080`.

## Stack

- **Language:** Go 1.25.0
- **Framework:** Gin v1.12.0 + gin-contrib/cors
- **Database:** PostgreSQL 15 (via Docker)
- **SQL toolkit:** sqlx + lib/pq driver

## Directory Structure

```
public_backend/
├── main.go                     # Entry point, router setup, public HTTP handlers
├── admin_handlers.go           # All /admin/* route handlers
├── structs.go                  # All data models and request/response types
├── helpers.go                  # getenv(), loaddbconfig(), parseCentralTime()
├── go.mod / go.sum
├── docker-compose.yml          # PostgreSQL container (service: postgres-db)
├── tests.sh                    # Manual curl test script
├── db/
│   ├── init_schema.sql         # Full schema DDL + seed data
│   ├── 02_messages_schema.sql  # messages + texts tables
│   └── 03_invite_opened_at.sql # ALTER TABLE migration for opened_at column
└── web-service-gin             # Compiled binary
```

## Running Locally

```bash
# From the repo root — starts everything at once:
./dev.sh

# Or individually:
docker-compose up -d
ADMIN_ENABLED=true go run .   # admin pod
ADMIN_ENABLED=false go run .  # public pod (separate terminal / separate instance)
```

The `dev.sh` script at the repo root starts postgres (detached), waits for it to be ready, then starts the backend with `air` and both UIs.

## Environment Variables

| Variable           | Default                  | Purpose                                        |
|--------------------|--------------------------|------------------------------------------------|
| `ADMIN_ENABLED`    | `false`                  | `"true"` enables /admin routes                 |
| `INVITEE_BASE_URL` | `http://localhost:5174`  | Base URL prepended to invite links shown in admin UI |
| `DBUSER`           | `myuser`                 | PostgreSQL username                            |
| `DBPASS`           | `mypassword`             | PostgreSQL password                            |
| `DBHOST`           | `127.0.0.1`              | Database host                                  |
| `DBPORT`           | `5432`                   | PostgreSQL port                                |

Database name is hardcoded as `party_time`.

## CORS

Allows origins `http://localhost:5173` (admin UI) and `http://localhost:5174` (invitee UI).

## API Endpoints

### Public routes (always available)

| Method | Path           | Description                                                              |
|--------|----------------|--------------------------------------------------------------------------|
| GET    | `/invites`     | List all raw invite records                                              |
| GET    | `/invite/:id`  | Enriched invite + co-invitees; stamps `opened_at` on first call          |
| PUT    | `/invite/:id`  | Update RSVP status and additional_guests                                 |
| GET    | `/event/:id`   | Get a single event by ID                                                 |

**`GET /invite/:id`** returns `InvitePageResponse`:
- All invite + contact + event fields (via `InvitePageData`)
- `co_invitees` — other invitees for the same event (first name, last initial, RSVP, additional guests), ordered Accepted → Tentative → No Response → Declined
- Side-effect: sets `opened_at = NOW()` on the invite if it has never been opened before

**`PUT /invite/:id`** body: `{ "rsvp_status": "Accepted"|"Tentative"|"Declined"|"No Response", "additional_guests": 0 }`

### Admin routes (`ADMIN_ENABLED=true` only, prefix `/admin`)

| Method | Path                         | Description                                               |
|--------|------------------------------|-----------------------------------------------------------|
| GET    | `/admin/contacts`            | List all contacts ordered by name                         |
| POST   | `/admin/contacts`            | Create a new contact                                      |
| PUT    | `/admin/contacts/:id`        | Update a contact's name / phone                           |
| GET    | `/admin/events`              | List all events with RSVP counts (`EventSummary`)         |
| POST   | `/admin/events`              | Create a new event                                        |
| GET    | `/admin/events/:id`          | Get event + invitees ordered by RSVP (`EventDetail`)      |
| PUT    | `/admin/events/:id`          | Update event fields (auto-save)                           |
| POST   | `/admin/events/:id/invites`  | Add invitee — supply `contact_id` OR new contact fields   |
| POST   | `/admin/events/:id/messages` | Queue a message as pending texts for non-declined guests  |

**`POST /admin/events/:id/invites`** accepts either:
- `{ "contact_id": N }` — invite an existing contact by ID
- `{ "first_name", "last_name", "phone_number" }` — upserts contact by phone number then creates invite

**`GET /admin/events/:id`** invitees include `invite_url` (constructed from `INVITEE_BASE_URL`) and `opened_at` (null if never opened).

## Database Schema

**contacts** — `id` (bigint), `first_name`, `last_name`, `phone_number` (unique)  
**events** — `id` (bigint), `name`, `date` (TIMESTAMPTZ), `description`, `location`, `plus_ones_allowed`  
**invites** — `id` (UUID, auto-generated), `attending`, `additional_guests`, `event_id`, `contact_id`, `opened_at` (TIMESTAMPTZ, null until first open)  
**messages** — `id`, `content`, `event_id`  
**texts** — `id`, `contact_id`, `message_id`, `status` (`pending` | `sent` | `failed`)

Foreign keys: `invites.event_id → events.id`, `invites.contact_id → contacts.id`, `messages.event_id → events.id`, `texts.contact_id → contacts.id`, `texts.message_id → messages.id`

RSVP status values: `Accepted`, `Tentative`, `Declined`, `No Response`

## Key Data Models (structs.go)

- `InvitePageData` — enriched invite row (invite + contact name + all event fields); `EventDate` is `time.Time`
- `InvitePageResponse` — wraps `InvitePageData` and adds `CoInvitees []CoInvitee`
- `CoInvitee` — first name, last initial (computed via `LEFT(last_name,1)`), RSVP status, additional guests
- `EventSummary` — event row with aggregated RSVP counts; `Date` is `time.Time`
- `EventDetail` — `Event` + `[]InviteWithContact` for the admin event detail page
- `InviteWithContact` — invite row joined with contact name/phone; includes `OpenedAt *time.Time` and `InviteURL string`

## Date Handling

All event dates are stored as `TIMESTAMPTZ`. The `parseCentralTime()` helper in `helpers.go` parses the `datetime-local` string format (`"2006-01-02T15:04"`) sent from the frontend, interpreting it as `America/Chicago` time before storing.

## Known TODOs

- Messages are queued in the `texts` table but no cron job or Twilio integration yet sends them
- No authentication on admin routes (relies on network-level isolation)
- Port is not configurable via env var (hardcoded `:8080`)
