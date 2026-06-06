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
├── main.go              # Entry point, router setup, public HTTP handlers
├── admin_handlers.go    # All /admin/* route handlers
├── structs.go           # All data models and request/response types
├── helpers.go           # getenv() and loaddbconfig() utilities
├── go.mod / go.sum      # Module definition and dependency checksums
├── docker-compose.yml   # PostgreSQL container config
├── tests.sh             # Manual curl test script
├── db/
│   ├── init_schema.sql  # Base schema DDL + seed data (contacts, events, invites)
│   └── 02_messages_schema.sql  # messages and texts tables
└── web-service-gin      # Compiled binary
```

## Running Locally

```bash
# 1. Start PostgreSQL
docker-compose up -d

# 2. Apply schema (first time only)
psql -U myuser -d party_time -f db/init_schema.sql
psql -U myuser -d party_time -f db/02_messages_schema.sql

# 3. Run the server
ADMIN_ENABLED=true go run .   # admin pod
ADMIN_ENABLED=false go run .  # public pod
```

## Environment Variables

| Variable        | Default       | Purpose                                        |
|-----------------|---------------|------------------------------------------------|
| `ADMIN_ENABLED` | `false`       | `"true"` enables /admin routes                 |
| `DBUSER`        | `myuser`      | PostgreSQL username                            |
| `DBPASS`        | `mypassword`  | PostgreSQL password                            |
| `DBHOST`        | `127.0.0.1`   | Database host                                  |
| `DBPORT`        | `5432`        | PostgreSQL port                                |

Database name is hardcoded as `party_time`.

## CORS

Allows origins `http://localhost:5173` (admin UI) and `http://localhost:5174` (invitee UI).

## API Endpoints

### Public routes (always available)

| Method | Path           | Description                                                    |
|--------|----------------|----------------------------------------------------------------|
| GET    | `/invites`     | List all raw invite records                                    |
| GET    | `/invite/:id`  | Get enriched invite — includes contact name + full event info  |
| PUT    | `/invite/:id`  | Update RSVP status and additional_guests for an invite         |
| GET    | `/event/:id`   | Get a single event by ID                                       |

`GET /invite/:id` returns `InvitePageData` — a joined view of invites + contacts + events, which is all the invitee UI needs in a single call.

`PUT /invite/:id` body: `{ "rsvp_status": "Accepted"|"Tentative"|"Declined"|"No Response", "additional_guests": 0 }`

### Admin routes (`ADMIN_ENABLED=true` only, prefix `/admin`)

| Method | Path                        | Description                                              |
|--------|-----------------------------|----------------------------------------------------------|
| GET    | `/admin/contacts`           | List all contacts ordered by name                        |
| POST   | `/admin/contacts`           | Create a new contact                                     |
| PUT    | `/admin/contacts/:id`       | Update a contact's name / phone                          |
| GET    | `/admin/events`             | List all events with RSVP counts (EventSummary)          |
| POST   | `/admin/events`             | Create a new event                                       |
| GET    | `/admin/events/:id`         | Get event + invitees ordered by RSVP (EventDetail)       |
| PUT    | `/admin/events/:id`         | Update event fields (used for auto-save)                 |
| POST   | `/admin/events/:id/invites` | Add invitee — supply contact_id OR new contact fields    |
| POST   | `/admin/events/:id/messages`| Queue a message as pending texts for non-declined guests |

`POST /admin/events/:id/invites` accepts either `{ "contact_id": N }` (existing contact) or `{ "first_name", "last_name", "phone_number" }` (new contact — upserts on phone number).

## Database Schema

**contacts** — guest info (`id`, `first_name`, `last_name`, `phone_number` unique)  
**events** — event details (`id`, `name`, `date`, `description`, `location`, `plus_ones_allowed`)  
**invites** — joins contacts ↔ events (`id`, `attending`, `additional_guests`, `event_id`, `contact_id`)  
**messages** — messages an event coordinator wants to send (`id`, `content`, `event_id`)  
**texts** — per-invitee send queue (`id`, `contact_id`, `message_id`, `status`: `pending`|`sent`|`failed`)

Foreign keys: `invites.event_id → events.id`, `invites.contact_id → contacts.id`, `messages.event_id → events.id`, `texts.contact_id → contacts.id`, `texts.message_id → messages.id`

RSVP status values: `Accepted`, `Tentative`, `Declined`, `No Response`

## Key Data Models (structs.go)

- `InvitePageData` — enriched invite response for the invitee UI (invite + contact + event fields)
- `EventSummary` — event row with aggregated RSVP counts for the admin events list
- `EventDetail` — event + `[]InviteWithContact` ordered by RSVP status for the admin event detail page
- `InviteWithContact` — invite row joined with contact name and phone

## Known TODOs

- Messages are queued in the `texts` table but no cron job or Twilio integration yet sends them
- No authentication on admin routes (relies on network-level isolation)
- Port is not configurable via env var (hardcoded `:8080`)
