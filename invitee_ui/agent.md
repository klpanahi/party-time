# Party Time — Invitee UI

## Project Overview

Public-facing frontend for invitees to view their event invitation and submit their RSVP. Invitees receive a text message with a link containing their `invite_id`; that link opens this app. No authentication.

Communicates exclusively with the **public pod** of the backend (`ADMIN_ENABLED=false`) at `http://localhost:8080`.

## Stack

- **Framework:** React 19 + Vite
- **Routing:** React Router v7
- **Styling:** Plain CSS (`src/App.css`) — mobile-first design
- **API:** Inline fetch calls in `InvitePage.jsx` — no shared API client

## Directory Structure

```
invitee_ui/
├── index.html
├── vite.config.js
├── src/
│   ├── main.jsx             # React root
│   ├── App.jsx              # Router setup
│   ├── App.css              # All styles — mobile-first
│   ├── index.css            # Empty (resets handled in App.css)
│   └── pages/
│       ├── InvitePage.jsx   # /invite/:id — the full invite experience
│       └── NotFound.jsx     # Catch-all for invalid routes
```

## Running Locally

```bash
npm install
npm run dev   # starts on http://localhost:5174
```

Requires the public backend pod to be running on `:8080`.

## Routes

| Path           | Page        | Description                                   |
|----------------|-------------|-----------------------------------------------|
| `/invite/:id`  | InvitePage  | Loads and displays the invite for the given ID |
| `*`            | NotFound    | Shown for any unrecognised URL                |

## Invite Page Behaviour

On mount, `GET /invite/:id` is called. The backend returns a single enriched `InvitePageData` object — no additional calls needed.

**Displayed information:**
- Invitee's first name (greeting)
- Event name, date, location, description

**RSVP selection:**
- Three large tap-friendly buttons: **Attending** (`Accepted`), **Maybe** (`Tentative`), **Can't make it** (`Declined`)
- Each button lights up with its own colour when selected (green / amber / red)
- Selecting any option immediately calls `PUT /invite/:id` — no submit button

**Plus ones:**
- A +/− counter appears only when `plus_ones_allowed` is `true` and the invitee hasn't declined
- Each tap immediately calls `PUT /invite/:id` with the updated `additional_guests` count

**Save status:**
- Shows "Saving…" during the request and "Saved ✓" on success
- Shows an inline error message on failure

## Backend API Used

| Method | Path           | Purpose                                        |
|--------|----------------|------------------------------------------------|
| GET    | `/invite/:id`  | Fetch enriched invite (contact + event fields) |
| PUT    | `/invite/:id`  | Save RSVP status and additional_guests         |

`PUT` body: `{ "rsvp_status": "Accepted"|"Tentative"|"Declined"|"No Response", "additional_guests": 0 }`

## Design Notes

- Mobile-first: designed for phone screens (invitees arrive via a text link)
- `100dvh` layout fills the full phone viewport
- Large touch targets on all interactive elements (`-webkit-tap-highlight-color: transparent`)
- Gradient header (blue → purple) on the invite card for visual appeal
- All styles in `src/App.css`; no CSS modules or utility frameworks
