# Party Time — Admin UI

## Project Overview

Internal admin frontend for the Party Time event invitation system. Used by the event coordinator to manage events, contacts, and invitees. Communicates exclusively with the **admin pod** of the backend (`ADMIN_ENABLED=true`) at `http://localhost:8080`.

Not publicly accessible — intended for internal use only.

## Stack

- **Framework:** React 19 + Vite
- **Routing:** React Router v7
- **Styling:** Plain CSS (`src/App.css`) with CSS custom properties
- **API:** Thin fetch wrapper in `src/api.js` — no third-party HTTP client

## Directory Structure

```
admin_ui/
├── index.html
├── vite.config.js
├── src/
│   ├── main.jsx             # React root
│   ├── App.jsx              # Router + top nav (Nav component lives here)
│   ├── App.css              # All styles — single global stylesheet
│   ├── api.js               # All fetch calls to /admin/* endpoints
│   └── pages/
│       ├── EventSummary.jsx # / — events list (upcoming + past) + create event modal
│       ├── EventDetails.jsx # /event/:id — event editing, invitees, send message
│       └── Contacts.jsx     # /contacts — contact book (view, add, edit)
```

## Running Locally

```bash
npm install
npm run dev   # starts on http://localhost:5173
```

Requires the backend admin pod to be running on `:8080`.

## Routes

| Path          | Page           | Description                                    |
|---------------|----------------|------------------------------------------------|
| `/`           | EventSummary   | All events split into Upcoming / Past sections |
| `/event/:id`  | EventDetails   | Edit event fields, manage invitees, send message |
| `/contacts`   | Contacts       | View and edit the contact book                 |

## Key Behaviours

### EventSummary (`/`)
- Fetches `GET /admin/events` — events with aggregated RSVP counts.
- Splits into **Upcoming** and **Past** sections. A past event is one whose `date` string parses to before today; unparseable dates stay in upcoming.
- Clicking an event row navigates to `/event/:id`.
- "Create Event" button opens a modal; on success navigates directly to the new event's detail page.

### EventDetails (`/event/:id`)
- **Auto-save:** editable fields (name, date, location, description, plus ones) debounce 800ms then call `PUT /admin/events/:id`. A "Saved" indicator appears briefly.
- **Add Invitee modal** — two tabs:
  - *From Contacts*: search box filtering existing contacts by name or phone. Contacts already on this event are hidden. Clicking a row calls `POST /admin/events/:id/invites` with `{ contact_id }`.
  - *New Contact*: form that calls `POST /admin/events/:id/invites` with name + phone fields; the backend upserts the contact then creates the invite.
- **Send a Message:** text area + Send button calls `POST /admin/events/:id/messages`; the backend queues pending texts for all non-declined invitees.
- Invitees table is ordered by RSVP: Accepted → Tentative → No Response → Declined.

### Contacts (`/contacts`)
- Fetches `GET /admin/contacts`.
- **Add Contact:** modal calls `POST /admin/contacts`.
- **Edit:** each row has an Edit button that opens the same modal pre-filled; saves via `PUT /admin/contacts/:id`.

## API Client (`src/api.js`)

All calls go to `http://localhost:8080/admin`. Throws on non-2xx responses with the error message from the response body.

| Export           | Method | Path                          |
|------------------|--------|-------------------------------|
| `getContacts`    | GET    | `/contacts`                   |
| `createContact`  | POST   | `/contacts`                   |
| `updateContact`  | PUT    | `/contacts/:id`               |
| `getEvents`      | GET    | `/events`                     |
| `getEvent`       | GET    | `/events/:id`                 |
| `createEvent`    | POST   | `/events`                     |
| `updateEvent`    | PUT    | `/events/:id`                 |
| `addInvitee`     | POST   | `/events/:id/invites`         |
| `sendMessage`    | POST   | `/events/:id/messages`        |

## Styling Notes

All styles live in `src/App.css`. CSS custom properties are defined on `:root`. No CSS modules, no Tailwind. Component-specific class names are descriptive and flat (e.g. `.invite-card`, `.rsvp-btn`).

RSVP status badge colours: Accepted = green, Tentative = amber, Declined = red, No Response = grey.
