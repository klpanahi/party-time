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
  id          bigint IDENTITY PK
  contact_id  int → contacts.id
  message_id  int → messages.id  (NULL for invite texts)
  event_id    int → events.id
  status      varchar DEFAULT 'pending'   -- 'pending' | 'sent'
  content     TEXT NULL                  -- set for invite texts; NULL means use message.content
  created_at  TIMESTAMPTZ DEFAULT NOW()
```

## Relationships
```
contacts ──< invites >── events
contacts ──< texts
events   ──< messages ──< texts
```

## Migration History
```
init_schema.sql          contacts, events, invites + seed data
02_messages_schema.sql   messages, texts tables
03_invite_opened_at.sql  ADD COLUMN invites.opened_at
04_event_status.sql      ADD COLUMN events.status DEFAULT 'draft'
05_texts_improvements.sql texts.content column (for invite texts without a message record)
```

## Notes
- Invite IDs are UUIDs — safe to embed in SMS links
- `texts.content` is populated for launch/add-invitee flows; NULL means resolve via `messages.content`
- `contacts.phone_number` has unique constraint — upsert used in `adminAddInvitee`
