<!-- Generated: 2026-08-02 | Files scanned: 21 | Token estimate: ~510 -->

# Frontend

## Admin UI (`admin_ui/`, port 5173)

### Page Tree
```
App.jsx
├── / → EventSummary.jsx      — event list (upcoming/past) with RSVP counts; create event modal
├── /event/:id → EventDetails.jsx — auto-save event form; tabs: Invitees | Messages
│     ├── Invitees tab: invitee table (RSVP, opened_at, invite link), add invitee modal
│     │   "Notify invitees of changes" quick-compose (launched events only)
│     │   Send a Message form (non-declined invitees; auto-appends personal RSVP link)
│     └── Messages tab: texts log with expandable content rows
└── /contacts → Contacts.jsx  — contact list, create/edit contact modal
```

### API Layer
`admin_ui/src/api.js` — all fetch calls to `http://localhost:8080/admin`
```
getContacts()        GET  /admin/contacts
createContact(data)  POST /admin/contacts
updateContact(id)    PUT  /admin/contacts/:id
getEvents()          GET  /admin/events
getEvent(id)         GET  /admin/events/:id
createEvent(data)    POST /admin/events
updateEvent(id)      PUT  /admin/events/:id
addInvitee(eid,data) POST /admin/events/:id/invites
sendMessage(eid,msg) POST /admin/events/:id/messages
launchEvent(eid)     POST /admin/events/:id/launch
getTexts(eid)        GET  /admin/events/:id/texts
```

### Utilities
`admin_ui/src/dateUtils.js` — date formatting helpers

### Testing
- Vitest + Testing Library + MSW; coverage via `@vitest/coverage-v8`
- `src/test/setup.js` — global jest-dom matchers
- `src/test/msw/handlers.js` — MSW handlers for all admin API routes (events, contacts, texts, messages, invites, launch)
- `src/test/msw/server.js` — MSW server setup
- `src/pages/EventSummary.test.jsx` — event list, create event, upcoming/past split
- `src/pages/EventDetails.test.jsx` — invitee tab, messages tab, launch, add invitee, send message, notify changes
- `src/pages/Contacts.test.jsx` — contact list, add/edit contact
- `src/dateUtils.test.js` — date formatting

---

## Invitee UI (`invitee_ui/`, port 5174)

### Page Tree
```
App.jsx
├── /invite/:id → InvitePage.jsx — RSVP form; fetches GET /invite/:id, submits PUT /invite/:id
│     co-invitees list (first name + last initial, RSVP pill, guest count)
│     past-event read-only notice; plus-ones counter (if allowed & not declined)
└── * → NotFound.jsx
```

### Testing
- Vitest + Testing Library + MSW
- `src/pages/InvitePage.test.jsx`
- Coverage report in `coverage/`

---

## Shared Config
Both UIs: React 19, Vite 8, react-router-dom 7, Vitest 4
