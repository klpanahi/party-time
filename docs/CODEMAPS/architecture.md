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
    ├─► PostgreSQL (primary store + texts outbox/queue)
    └─► Text worker (goroutine) ──► Twilio SMS API
```

## Monorepo Layout

```
party-time/
├── public_backend/     Go/Gin API server (serves both UIs)
├── admin_ui/           React admin portal (event & contact mgmt)
├── invitee_ui/         React invitee portal (RSVP page)
├── schema.sql          Canonical DB schema (structural single source of truth)
├── test_data.sql       Local dev seed data (loaded fresh by run_local.sh)
├── docker-compose.yml  Local PostgreSQL container
├── run_local.sh        Starts all three services at once
└── AGENT.md            Project-wide developer guide
```

## Data Flow: Event Lifecycle

```
Draft event → Add invitees → Launch event
                              │
                    INSERT texts (pending) per invitee   ◄── handler returns immediately
                              │
                    Text worker claims batch (pending → sending)
                              │
                    Twilio Create-Message per recipient
                              │
                    status → sent (provider_sid) | failed (error)
```

## Key Design Decisions

- Single Go binary serves both public and admin routes; admin routes gated by `ADMIN_ENABLED=true` env var
- Invites identified by UUID (not integer) — safe to expose in URLs
- `opened_at` recorded on first `GET /invite/:id` (non-blocking fire-and-forget)
- Messages (broadcast) vs direct invite texts stored separately in `texts` table
- SMS uses a DB-backed outbox (the `texts` table) drained by a background goroutine — no external queue (RabbitMQ etc.). Admin requests never block on Twilio; the worker claims rows with `FOR UPDATE SKIP LOCKED` and sends at-most-once (fail-fast, manual resend)
