# Party Time — Admin UI

## Project Overview

Internal admin frontend for the Party Time event invitation system. Used by the event coordinator to manage events, contacts, and invitees. Communicates exclusively with the **admin pod** of the backend (`ADMIN_ENABLED=true`) at `http://localhost:8080`.

Not publicly accessible — intended for internal use only.

## Stack

- **Framework:** React 19 + Vite (port **5173**, pinned via `strictPort: true`)
- **Routing:** React Router v7
- **Styling:** Plain CSS (`src/App.css`) with CSS custom properties
- **API:** Thin fetch wrapper in `src/api.js` — no third-party HTTP client

## Directory Structure

```
admin_ui/
├── index.html
├── vite.config.js           # Port pinned to 5173, strictPort: true
├── src/
│   ├── main.jsx             # React root
│   ├── App.jsx              # Router + top nav (Nav component lives here)
│   ├── App.css              # All styles — single global stylesheet
│   ├── api.js               # All fetch calls to /admin/* endpoints
│   ├── dateUtils.js         # toDatetimeLocal(), formatDateShort()
│   └── pages/
│       ├── EventSummary.jsx # / — events list (upcoming + past) + create event modal
│       ├── EventDetails.jsx # /event/:id — event editing, invitees, send message
│       └── Contacts.jsx     # /contacts — contact book (view, add, edit)
```

## Running Locally

```bash
npm install
npm run dev   # always starts on http://localhost:5173
```

Requires the backend admin pod running on `:8080`. Use `./dev.sh` from the repo root to start everything at once.

## Routes

| Path          | Page           | Description                                      |
|---------------|----------------|--------------------------------------------------|
| `/`           | EventSummary   | All events split into Upcoming / Past sections   |
| `/event/:id`  | EventDetails   | Edit event fields, manage invitees, send message |
| `/contacts`   | Contacts       | View and edit the contact book                   |

## Key Behaviours

### EventSummary (`/`)
- Fetches `GET /admin/events` — events with aggregated RSVP counts.
- Splits into **Upcoming** and **Past** by comparing `event.date` (a real ISO timestamp) to now. Works correctly because dates are stored as `TIMESTAMPTZ`.
- Event dates are formatted for display using `formatDateShort()` from `dateUtils.js`.
- Clicking an event row navigates to `/event/:id`.
- "Create Event" opens a modal with a `datetime-local` date picker; on success navigates directly to the new event's detail page.

### EventDetails (`/event/:id`)
- **Auto-save:** editable fields (name, date, location, description, plus ones) debounce 800ms then call `PUT /admin/events/:id`.
  - On load, `event.date` is immediately normalised to `YYYY-MM-DDTHH:MM` format via `toDatetimeLocal()` so that auto-saves triggered by non-date fields (e.g. toggling plus ones) send the correct format to `parseCentralTime()` on the backend.
- **Invitees table** columns: Name, Phone, RSVP, +Guests, Opened, Invite Link.
  - **Opened** — shows the timestamp of first invite link open, or muted "Not yet".
  - **Invite Link** — the full URL (from `invite_url` in the API response) with a Copy button.
- **Add Invitee modal** — two tabs:
  - *From Contacts*: search by name or phone; contacts already on this event are hidden; click a row to invite instantly.
  - *New Contact*: name + phone form; backend upserts the contact and creates the invite.
- **Send a Message:** text area + Send button calls `POST /admin/events/:id/messages`; backend queues pending texts for all non-declined invitees.
- Invitees are ordered: Accepted → Tentative → No Response → Declined.

### Contacts (`/contacts`)
- Fetches `GET /admin/contacts`.
- **Add Contact:** "+ Add Contact" button opens a modal that calls `POST /admin/contacts`.
- **Edit:** each row has an Edit button that opens the same modal pre-filled; saves via `PUT /admin/contacts/:id`.

## Date Utilities (`src/dateUtils.js`)

| Export            | Purpose                                                                 |
|-------------------|-------------------------------------------------------------------------|
| `toDatetimeLocal` | Converts an ISO timestamp to `YYYY-MM-DDTHH:MM` for `datetime-local` inputs and for state normalisation |
| `formatDateShort` | Formats an ISO timestamp as `"Mar 7, 2025, 6:00 PM"` for table display |

## API Client (`src/api.js`)

All calls target `http://localhost:8080/admin`. Throws on non-2xx with the error message from the response body.

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

All styles live in `src/App.css`. CSS custom properties on `:root`. No CSS modules, no Tailwind.

RSVP badge colours: Accepted = green, Tentative = amber, Declined = red, No Response = grey.
