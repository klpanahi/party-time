# Party Time — Public Backend

Go + Gin REST API. See `agent.md` for full architecture and endpoint reference.

## Running tests

Tests are integration tests — they run against a real PostgreSQL instance (no mocks).

**Prerequisites:** the postgres container must be running.

```bash
# From the repo root, start postgres if it isn't already up:
docker-compose -f public_backend/docker-compose.yml up -d postgres-db

# Run all tests from the public_backend directory:
go test ./...
```

The test suite automatically creates a `party_time_test` database on first run, applies the full schema, and truncates all tables between test groups. Your development database (`party_time`) is never touched.

### Verbose output

```bash
go test -v ./...
```

### Run a single test

```bash
go test -v -run TestLaunchEvent ./...
```

### Run a single sub-test

```bash
go test -v -run "TestLaunchEvent/invite_message_contains_all_required_content" ./...
```

## What's tested

| Test | Coverage |
|------|----------|
| `TestContacts` | CRUD for contacts, validation |
| `TestEvents` | Create/read/update events, draft status default, date validation |
| `TestAddInvitee` | Existing contact, new contact upsert, auto-queue text on launched event |
| `TestLaunchEvent` | Queues texts, message content, 409 on re-launch, 400 with no invitees |
| `TestInviteeOrdering` | Accepted → Tentative → No Response → Declined sort order |
| `TestSendMessage` | Broadcast texts skip declined invitees |
| `TestGetTexts` | Text list includes contact name, status, timestamp, content |
| `TestGetInvite` | Enriched invite response, `opened_at` stamped once, co-invitees |
| `TestUpdateInvite` | RSVP and guest count persisted, reflected in co-invitees |
