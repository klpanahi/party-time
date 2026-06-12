<!-- Generated: 2026-06-11 | Files scanned: 12 | Token estimate: ~450 -->

# Frontend

## Admin UI (`admin_ui/`, port 5173)

### Page Tree
```
App.jsx
├── / → EventSummary.jsx      — event list with RSVP counts; create/launch event
├── /event/:id → EventDetails.jsx — invitee list, add invitee, send message, view texts
└── /contacts → Contacts.jsx  — contact list, create/edit contact
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
`admin_ui/src/dateUtils.js` — date formatting helpers (tested in `dateUtils.test.js`)

### Testing
- Vitest + Testing Library + MSW
- `src/test/msw/handlers.js` — API mock handlers
- `src/test/msw/server.js` — MSW server setup
- `EventSummary.test.jsx` — page-level test

---

## Invitee UI (`invitee_ui/`, port 5174)

### Page Tree
```
App.jsx
├── /invite/:id → InvitePage.jsx — RSVP form; fetches GET /invite/:id, submits PUT /invite/:id
└── * → NotFound.jsx
```

### Testing
- Vitest + Testing Library + MSW
- `src/pages/InvitePage.test.jsx`
- Coverage report in `coverage/`

---

## Shared Config
Both UIs: React 19, Vite 8, react-router-dom 7, Vitest 4
