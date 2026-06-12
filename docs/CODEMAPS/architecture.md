<!-- Generated: 2026-06-11 | Files scanned: 30 | Token estimate: ~400 -->

# Architecture

## System Overview

```
Admin UI (React, :5173)
    └─► Backend (:8080) /admin/*
                 │
Invitee UI (React, :5174)
    └─► Backend (:8080) /invite/:id, /event/:id

Backend (Go/Gin)
    └─► PostgreSQL (primary store)
```

## Monorepo Layout

```
party-time/
├── public_backend/     Go/Gin API server (serves both UIs)
├── admin_ui/           React admin portal (event & contact mgmt)
├── invitee_ui/         React invitee portal (RSVP page)
├── schema.sql          Canonical DB schema + sample data (single source of truth)
├── docker-compose.yml  Local PostgreSQL container
├── run_local.sh        Starts all three services at once
└── AGENT.md            Project-wide developer guide
```

## Data Flow: Event Lifecycle

```
Draft event → Add invitees → Launch event
                              │
                    INSERT texts (pending) per invitee
                              │
                    External SMS delivery (status: pending → sent)
```

## Key Design Decisions

- Single Go binary serves both public and admin routes; admin routes gated by `ADMIN_ENABLED=true` env var
- Invites identified by UUID (not integer) — safe to expose in URLs
- `opened_at` recorded on first `GET /invite/:id` (non-blocking fire-and-forget)
- Messages (broadcast) vs direct invite texts stored separately in `texts` table
