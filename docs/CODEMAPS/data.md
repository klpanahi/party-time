<!-- Generated: 2026-08-02 | Files scanned: 6 | Token estimate: ~360 -->

# Data

## Tables (party_time schema)

```
contacts
  id            bigint IDENTITY PK
  first_name    varchar NULL
  last_name     varchar NULL
  phone_number  varchar NOT NULL UNIQUE

events
  id                bigint IDENTITY PK
  name              varchar NOT NULL
  date              TIMESTAMPTZ NOT NULL
  description       varchar NOT NULL
  location          varchar NOT NULL
  plus_ones_allowed bool NOT NULL
  status            varchar DEFAULT 'draft'   -- 'draft' | 'launched'

invites
  id                uuid DEFAULT gen_random_uuid() PK
  attending         varchar DEFAULT 'No Response' NULL  -- 'Accepted'|'Tentative'|'Declined'|'No Response'
  additional_guests int DEFAULT 0 NULL
  event_id          bigint → events.id
  contact_id        bigint → contacts.id
  opened_at         TIMESTAMPTZ NULL           -- set on first invite page load

messages
  id        bigint IDENTITY PK
  content   varchar NOT NULL
  event_id  bigint → events.id

texts
  id            bigint IDENTITY PK
  contact_id    bigint → contacts.id
  message_id    bigint → messages.id  (NULL for invite texts)
  event_id      bigint → events.id
  status        varchar DEFAULT 'pending'   -- 'pending'|'sending'|'sent'|'failed'
  content       TEXT NULL                  -- set for invite texts; NULL means use message.content
  provider_sid  varchar NULL               -- Twilio Message SID, set on send
  error         varchar NULL               -- failure reason when status='failed'
  sent_at       TIMESTAMPTZ NULL           -- set when Twilio accepts the message
  created_at    TIMESTAMPTZ DEFAULT NOW()
  INDEX texts_status_idx (status, created_at)  -- worker poll
```

## Relationships
```
contacts ──< invites >── events
contacts ──< texts
events   ──< messages ──< texts
```

## Schema File & Migrations
`public_backend/migrations/00001_init.sql` — goose migration (v3.27.3) that creates party_time schema and all tables in dependency order. Embedded in the backend binary via `//go:embed migrations/*.sql` and applied through `runMigrations()` in `migrate.go`. Used both by CLI (`party-time-backend migrate [up|status|down]`) and by test setup (`setup_test.go`). Local dev seed lives in `test_data.sql`, loaded fresh on every `run_local.sh` start (after `go run . migrate up`). Future schema changes added as new goose migrations rather than edits to the initial file.

## Notes
- Invite IDs are UUIDs — safe to embed in SMS links
- `texts.content` is populated for launch/add-invitee flows; NULL means resolve via `messages.content`
- `contacts.phone_number` has unique constraint — upsert used in `adminAddInvitee`
- `texts` is the SMS outbox: rows enter `pending`, the worker (`worker.go`) drives `sending → sent|failed`
