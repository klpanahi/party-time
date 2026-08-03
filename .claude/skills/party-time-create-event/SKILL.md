---
name: party-time-create-event
description: Creates an event in the Party Time admin UI at http://party-time.nginx-internal.local/ by driving Chrome through the chrome-devtools MCP tools, including the datetime-local field that fill and type_text silently fail to set. Use when the user asks to create, add, schedule, or seed an event in Party Time; wants a test event made; asks to verify or smoke-test the party-time admin deployment end to end; or mentions party-time.nginx-internal.local, the party-time admin app, or the admin events page.
---

# Create a Party Time event

Drives the real admin UI in Chrome so the whole path is exercised: nginx-internal
serves the bundle, proxies `/admin` to `docker.local:8081`, the admin backend
writes to Postgres.

## Prerequisites

- The `chrome-devtools` MCP tools are available (`mcp__plugin_ecc_chrome-devtools__*`).
- `http://party-time.nginx-internal.local/` resolves — it is LAN-only, no Cloudflare
  tunnel. If it does not resolve, the caller is off the LAN/VPN; say so and stop.
  (If plain `nginx-internal.local` resolves but this three-label name doesn't, the
  VM's `party-time-mdns-alias` systemd unit has died — see `ops/AGENT.md` hazard 6e.)

## Workflow

1. **Open the page**

   `new_page` with `url: http://party-time.nginx-internal.local/`. Title should be
   "Party Time — Admin". If you already have a tab, `navigate_page` instead.

2. **Open the modal**

   `take_snapshot`, then `click` the `+ Create Event` button's uid.
   Never reuse uids across calls — they change on every snapshot.

3. **Fill everything except the date**

   `fill_form` with the Name, Description, Location and "Allow plus ones"
   uids from the latest snapshot. Name and Location are required.

4. **Set the date — read [DATETIME.md](DATETIME.md) before this step**

   The `datetime-local` input **cannot** be set with `fill_form`, `fill`,
   `type_text`, or `press_key`. Use the native-setter script in DATETIME.md.
   Verify it returns `valid: true` before moving on.

5. **Submit and verify — do not trust the click alone**

   `click` the `Create` button, then confirm the result:

   ```
   list_network_requests with resourceTypes: ["fetch", "xhr"]
   get_network_request on the POST /admin/events reqid
   ```

   - **201/200** — created. The modal closes and the app navigates to the new
     event's detail page. Report the event name and id.
   - **400 / any error** — read the response body and check
     [TROUBLESHOOTING.md](TROUBLESHOOTING.md). Report the actual error; do not
     retry blindly or report success.

   A snapshot alone is not verification — the modal also stays open on failure,
   with the error text rendered above it.

## Defaults for a test event

Use a clearly-labelled future date so it lands under UPCOMING:

| Field | Value |
|---|---|
| Name | `Test Event` |
| Date | a date 2–4 weeks out, format `YYYY-MM-DDTHH:MM` |
| Description | why the event was created |
| Location | `Test Location` |
| Plus ones | checked |

Ask the user before creating an event with real guest-facing details, and never
launch an event or add invitees as a side effect — launching queues real SMS
through Twilio. Creating a draft event sends nothing.

## Cleanup

There is no delete-event route in the admin API. Test events persist until
removed directly from Postgres on the docker VM. Mention this rather than
leaving the user to discover the clutter.
