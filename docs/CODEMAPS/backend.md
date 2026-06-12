<!-- Generated: 2026-06-11 | Files scanned: 8 | Token estimate: ~600 -->

# Backend

## Entry Point
`public_backend/main.go` — sets up Gin router, DB connection, CORS, route registration

## Routes

### Public (always enabled)
```
GET  /invites              → getInvites           → SELECT * FROM invites
GET  /invite/:id           → getInviteByID         → JOIN invites+contacts+events, record opened_at
PUT  /invite/:id           → updateInvite          → UPDATE attending, additional_guests
GET  /event/:id            → getEventByID          → SELECT * FROM events
```

### Admin (ADMIN_ENABLED=true)
```
GET  /admin/contacts           → adminGetContacts      → SELECT * FROM contacts
POST /admin/contacts           → adminCreateContact    → INSERT contacts
PUT  /admin/contacts/:id       → adminUpdateContact    → UPDATE contacts

GET  /admin/events             → adminGetEvents        → events + RSVP count aggregation
POST /admin/events             → adminCreateEvent      → INSERT events
GET  /admin/events/:id         → adminGetEvent         → event + invitees joined
PUT  /admin/events/:id         → adminUpdateEvent      → UPDATE events
POST /admin/events/:id/invites → adminAddInvitee       → upsert contact + INSERT invite; if launched, queue invite text
POST /admin/events/:id/messages → adminSendMessage     → INSERT message + INSERT texts for non-declined invitees
GET  /admin/events/:id/texts   → adminGetTexts         → texts JOIN contacts LEFT JOIN messages
POST /admin/events/:id/launch  → adminLaunchEvent      → INSERT invite texts for all, UPDATE status='launched'
```

## Key Files
```
public_backend/main.go            router setup, public handlers, Env struct (120 lines)
public_backend/admin_handlers.go  admin route handlers + buildInviteMessage (357 lines)
public_backend/structs.go         all request/response/DB structs (139 lines)
public_backend/helpers.go         getenv, loaddbconfig, parseCentralTime
public_backend/handlers_test.go   integration tests: TestContacts, TestEvents (incl. update), TestAddInvitee,
                                   TestLaunchEvent, TestInviteeOrdering, TestSendMessage, TestGetTexts,
                                   TestGetInvite, TestUpdateInvite
public_backend/setup_test.go      test DB setup — loads ../schema.sql via os.ReadFile; seed helpers:
                                   seedContact, seedEvent, seedInvite, cleanDB, futureDate, pastDate
```

## Environment Variables
- `ADMIN_ENABLED` — "true" to expose /admin routes (default: "false")
- `INVITEE_BASE_URL` — base URL for invite links (default: "http://localhost:5174")
- DB config loaded from env via `loaddbconfig()` in helpers.go
