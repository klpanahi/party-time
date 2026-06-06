# Party Time — Public Backend

## Project Overview

REST API backend for an event invitation management system. Built in Go with the Gin framework and PostgreSQL. Manages contacts, events, and RSVP invitations.

## Stack

- **Language:** Go 1.25.0
- **Framework:** Gin v1.12.0
- **Database:** PostgreSQL 15 (via Docker)
- **SQL toolkit:** sqlx + lib/pq driver

## Directory Structure

```
public_backend/
├── main.go              # Entry point, router setup, HTTP handlers
├── structs.go           # Data models: Invite, Event, Contact, IdRequest
├── helpers.go           # getenv() and loaddbconfig() utilities
├── go.mod / go.sum      # Module definition and dependency checksums
├── docker-compose.yml   # PostgreSQL container config
├── tests.sh             # Manual curl test script
├── db/
│   └── init_schema.sql  # Schema DDL + seed data
└── web-service-gin      # Compiled binary
```

## Running Locally

```bash
# 1. Start PostgreSQL
docker-compose up -d

# 2. Run the server (ADMIN_ENABLED must be "true" to start)
ADMIN_ENABLED=true go run main.go structs.go helpers.go
```

Server listens on `localhost:8080`.

## Environment Variables

| Variable       | Default       | Purpose                          |
|----------------|---------------|----------------------------------|
| `ADMIN_ENABLED` | `false`      | Must be `"true"` to start server |
| `DBUSER`       | `myuser`      | PostgreSQL username              |
| `DBPASS`       | `mypassword`  | PostgreSQL password              |
| `DBHOST`       | `127.0.0.1`   | Database host                    |
| `DBPORT`       | `5432`        | Database port                    |

Database name is hardcoded as `party_time`.

## API Endpoints

| Method | Path          | Description                  |
|--------|---------------|------------------------------|
| GET    | `/invites`    | List all invitations         |
| GET    | `/invite/:id` | Get a single invite by ID    |
| GET    | `/event/:id`  | Get a single event by ID     |

## Database Schema

**contacts** — guest info (first name, last name, phone as unique key)  
**events** — event details (name, date, description, location, plus_ones_allowed flag)  
**invites** — joins contacts ↔ events (rsvp_status, additional_guests)

Foreign keys: `invites.event_id → events.id`, `invites.contact_id → contacts.id`

## Testing

```bash
bash tests.sh
# or manually:
curl http://localhost:8080/invites
curl http://localhost:8080/invite/1
curl http://localhost:8080/event/1
```

## Known Issues / TODOs

- SQL queries use string formatting — switch to parameterized queries to prevent injection
- No POST/PUT/DELETE routes yet
- Admin portal endpoint is stubbed/commented out
- Port is hardcoded to `localhost:8080` (not configurable via env)
- No authentication or CORS configuration
