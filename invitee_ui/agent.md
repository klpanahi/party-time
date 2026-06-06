# Party Time — Invitee UI

## Project Overview

Public-facing frontend for invitees to view their event invitation and submit their RSVP. Invitees receive a text message with a link containing their `invite_id`; that link opens this app. No authentication.

Communicates exclusively with the **public pod** of the backend (`ADMIN_ENABLED=false`) at `http://localhost:8080`.

## Stack

- **Framework:** React 19 + Vite (port **5174**, pinned via `strictPort: true`)
- **Routing:** React Router v7
- **Styling:** Plain CSS (`src/App.css`) — mobile-first design
- **API:** Inline fetch calls in `InvitePage.jsx` — no shared API client

## Directory Structure

```
invitee_ui/
├── index.html
├── vite.config.js           # Port pinned to 5174, strictPort: true
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
npm run dev   # always starts on http://localhost:5174
```

Requires the public backend pod running on `:8080`. Use `./dev.sh` from the repo root to start everything at once.

## Routes

| Path           | Page        | Description                                    |
|----------------|-------------|------------------------------------------------|
| `/invite/:id`  | InvitePage  | Loads and displays the invite for the given ID |
| `*`            | NotFound    | Shown for any unrecognised URL                 |

## Invite Page Behaviour

On mount, `GET /invite/:id` is called. This is the only API call the page makes — the backend returns everything needed in one response (`InvitePageResponse`).

### Displayed information
- Invitee's first name in a greeting header
- Event name (prominent, in the gradient header)
- Event date (formatted as e.g. "Friday, March 7, 2025 at 6:00 PM"), location, description

### RSVP selection
- Three large tap-friendly buttons: **Attending** (`Accepted`), **Maybe** (`Tentative`), **Can't make it** (`Declined`)
- Each button lights up with its own colour when selected (green / amber / red)
- Selecting any option immediately calls `PUT /invite/:id` — no submit button needed

### Plus ones
- A +/− counter appears only when `plus_ones_allowed` is `true` and the invitee hasn't declined
- Each tap immediately calls `PUT /invite/:id` with the updated `additional_guests` count

### Past event lock
- If `event_date` is in the past, all interactive controls (RSVP buttons, guest counter, save status) are replaced with a grey notice: *"This event has already taken place. Your RSVP can no longer be modified."*
- Event details still display so the invitee can see what they were invited to.

### Co-invitees list
- Shows below the RSVP section (or below the past notice) if there are other invitees on the same event.
- Each row displays: **first name + last initial** (e.g. "Sarah M."), an RSVP status pill, and a `+N` guest bubble if they're bringing additional guests.
- Ordered: Accepted → Tentative → No Response → Declined, then alphabetically by first name.

### Save status
- Shows "Saving…" during requests and "Saved ✓" on success
- Shows an inline error message on failure

## Backend API Used

| Method | Path           | Purpose                                                    |
|--------|----------------|------------------------------------------------------------|
| GET    | `/invite/:id`  | Fetch `InvitePageResponse` — invite, event, co-invitees    |
| PUT    | `/invite/:id`  | Save RSVP status and additional_guests                     |

**`PUT` body:** `{ "rsvp_status": "Accepted"|"Tentative"|"Declined"|"No Response", "additional_guests": 0 }`

**Side-effect of GET:** the backend stamps `opened_at` on the invite on the first call — this is how the admin UI tracks whether an invitee has opened their link.

## Design Notes

- Mobile-first: designed for phone screens (invitees arrive via a text link)
- `100dvh` layout fills the full phone viewport
- Large touch targets on all interactive elements (`-webkit-tap-highlight-color: transparent`)
- Gradient header (blue → purple) on the invite card
- All styles in `src/App.css`; no CSS modules or utility frameworks
- Invite IDs are UUIDs so links cannot be guessed
