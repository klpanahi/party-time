<!-- Generated: 2026-06-11 | Files scanned: 5 | Token estimate: ~350 -->

# Data

## Tables

```
contacts
  id            bigint IDENTITY PK
  first_name    varchar
  last_name     varchar
  phone_number  varchar UNIQUE NOT NULL

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
  attending         varchar DEFAULT 'No Response'  -- 'Accepted'|'Tentative'|'Declined'|'No Response'
  additional_guests int DEFAULT 0
  event_id          int → events.id
  contact_id        int → contacts.id
  opened_at         TIMESTAMPTZ NULL           -- set on first invite page load

messages
  id        bigint IDENTITY PK
  content   varchar NOT NULL
  event_id  int → events.id

texts
  id            bigint IDENTITY PK
  contact_id    int → contacts.id
  message_id    int → messages.id  (NULL for invite texts)
  event_id      int → events.id
  status        varchar DEFAULT 'pending'  -- 'pending'|'sending'|'sent'|'failed'
  content       TEXT NULL                 -- set for invite texts; NULL means use message.content
  provider_sid  varchar NULL              -- Twilio Message SID, set on send
  error         varchar NULL              -- failure reason when status='failed'
  sent_at       TIMESTAMPTZ NULL          -- set when Twilio accepts the message
  created_at    TIMESTAMPTZ DEFAULT NOW()
  INDEX texts_status_idx (status, created_at)  -- worker poll
```

## Relationships
```
contacts ──< invites >── events
contacts ──< texts
events   ──< messages ──< texts
```

## Schema File
`schema.sql` (repo root) — single consolidated DDL file; all tables in dependency order, purely structural. No separate migration files (boilerplate stage; data retention not required). Local dev seed lives in `test_data.sql`, loaded fresh on every `run_local.sh` start (after a `DROP SCHEMA public CASCADE` + reload). The test suite builds its own DB from `schema.sql` only.

## Notes
- Invite IDs are UUIDs — safe to embed in SMS links
- `texts.content` is populated for launch/add-invitee flows; NULL means resolve via `messages.content`
- `contacts.phone_number` has unique constraint — upsert used in `adminAddInvitee`
- `texts` is the SMS outbox: rows enter `pending`, the worker (`worker.go`) drives `sending → sent|failed`
