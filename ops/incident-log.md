# Incident Log

Real failures, what they looked like, and what actually fixed them. Ordered
newest first. The value here is the *symptoms* — most of these presented as
something other than their cause.

---

## 2026-07-31 — Both nginx VMs renamed themselves on the network

**Symptom:** `http://nginx-internal.local/` loaded the page shell but showed
"Failed to fetch"; the admin UI appeared to have no events. Sometimes the URL
worked, sometimes it returned `ERR_NAME_NOT_RESOLVED`. Intermittent, which made
it look like a browser or app problem.

**Misleading detail:** the events were in the database the whole time, and
`docker.local` resolved fine. Only the two nginx hosts were affected.

**Cause:** both nginx VMs had logged
`Host name conflict, retrying with nginx-cloudflared-2` / `-internal-2` at boot
and renamed themselves to `*-2.local`. Nothing was advertising the real names,
so resolution depended on whichever stale record won a race. A network flap can
make avahi see a delayed echo of its own address probe and wrongly conclude the
name is taken.

**Fix:** `sudo systemctl restart avahi-daemon` on each VM. Both reclaimed their
real names with no new conflict logged — confirming no real device was squatting.

**Tell:** compare several `.local` names at once. If some resolve and others
don't, suspect a hostname conflict, not general network trouble.

---

## 2026-07-31 — Invite URL served the wrong representation, permanently, to one browser

**Symptom:** `https://party-time.panahi-systems.com/invite/<uuid>` showed
"Unexpected token '<', "<!doctype "... is not valid JSON" — but only in a
browser that had loaded the URL earlier. Fresh clients worked fine.

**Misleading detail:** every server-side check passed. `curl` with each `Accept`
value returned the correct representation, and a raw `fetch()` from inside the
poisoned page also returned correct JSON. Only the app's real navigation failed.

**Cause:** `/invite/:id` is both a React route and a JSON API endpoint at the
identical URL. During a window where the response had no `Vary: Accept`, a
browser cached one representation keyed by URL alone — and `Vary` added later
cannot retroactively key an entry that was cached without it. That entry kept
answering every request regardless of `Accept`, immune to further server fixes.

**Fix:** `Cache-Control: no-store` on **both** branches of the ambiguous paths.
Note `rewrite ... last` re-enters location matching as a fresh internal request,
so `add_header` from the original location does not carry over — the HTML branch
needs its own `location = /index.html` block.

**Tell:** a bug that reproduces for one client and not another, where the server
is provably correct, is a cache-keying problem. `Vary` is not sufficient
retroactively; `no-store` removes the entire class.

---

## 2026-07-31 — Docker VM silently lost its IPv4 address for 17 hours

**Symptom:** Cloudflare returned its own 502 (`content-type: text/plain`, body
`error code: 502`). The public site was completely down.

**Misleading detail:** all three containers on the docker VM were still running
and healthy. The database was fine. Nothing in the app had failed.

**Cause:** `enp6s18` hit `Could not set NDisc address: Connection timed out` and
dropped to IPv6 link-local only — no global IPv4 at all. Because `nginx` resolves
its upstream at config-parse time and **refuses to start** when that fails, the
next nginx restart left it permanently `failed`.

**Fix:** `sudo networkctl reconfigure enp6s18` on the docker VM (same IP came
back), then `sudo systemctl start nginx` on the edge VM.

**Tell:** a Cloudflare-branded 502 means the tunnel can't reach nginx. An HTML
502 means nginx is up but can't reach the backend. That one distinction
localizes the fault immediately.

---

## 2026-07-30 — Stale `/etc/hosts` entry masked mDNS after a DHCP change

**Symptom:** 502 on the public invite URL. nginx error log showed
`connect() failed (113: No route to host)` against `192.168.68.89`.

**Cause:** the docker VM's DHCP lease had moved `.89 → .78` on 2026-07-27, but
`nginx-cloudflared` had a hardcoded `192.168.68.89 docker.local` line in
`/etc/hosts`. `nsswitch.conf` lists `files` before `mdns4_minimal`, so that line
silently overrode mDNS forever — restarting avahi had no effect.

Worse, `.89` had been reassigned to another device, so nginx was proxying to a
stranger rather than failing cleanly.

**Fix:** removed the line. It was not Ansible-managed, so nothing reintroduces it.

**Tell:** if a name resolves to a wrong IP and restarting avahi changes nothing,
check `/etc/hosts` before anything else.

---

## 2026-07-30 — Every event create/update returned 400 in production only

**Symptom:** `POST /admin/events` returned
`400 {"error":"invalid date format, expected YYYY-MM-DDTHH:MM"}` — while sending
exactly that format. All `GET` routes worked normally.

**Cause:** the production image is Alpine with no `tzdata`, and `CGO_ENABLED=0`
rules out the system fallback, so `time.LoadLocation("America/Chicago")` failed
for every request. `parseCentralTime` returns that error *before* parsing
anything, and both call sites map **any** error to the "invalid date format"
message — so a missing timezone database reported itself as a malformed client
date.

**Fix:** `import _ "time/tzdata"` in `public_backend/main.go`, embedding the IANA
database in the binary. Both call sites now log the underlying error.

**Tell:** the test suite structurally cannot catch this — tests run on hosts that
have zoneinfo. Any "works locally, fails in the container" date bug should point
here first.

---

## 2026-07-30 — A deploy that appeared to run but applied nothing

**Symptom:** playbook was started, ran for over 600 seconds, and was killed by a
tool timeout. Afterwards the containers were still 4 days old and the image
3 weeks old — nothing had been applied.

**Compounding mistake:** the command had been piped through `| tail -35`, so all
output was buffered and **lost entirely** when the process was killed. There was
no error to read and no indication of how far it got.

**Cause of the slowness:** the deploy recompiled Go *inside* the docker VM
(`build: always`) on 2 vCPU / 2 GB RAM / no swap, while Postgres was running.
Observed load average ~47. Every other task in the playbook finishes in seconds.

**Fix / practice:** never pipe `ansible-playbook` through `tail`. Redirect to a
log file and watch that file. Always verify a deploy landed by checking container
and image age rather than trusting the playbook's exit.

**Resolved 2026-07-31.** The Mac is arm64 and the VMs are amd64, which is why the
build had happened in-guest. But the backend is `CGO_ENABLED=0`, so Go
cross-compiles for free. `build.sh` now cross-builds `linux/amd64` locally and
exports `dist/party-time-backend-amd64.tar.gz`; the playbook ships that and
`docker load`s it, with `build: never` on the compose task and the backend
source rsync removed. The Dockerfile pins the builder to `$BUILDPLATFORM` with
`GOARCH=$TARGETARCH` so the compile runs natively rather than under QEMU.

Measured after the change: **build 56 s** (including the full test suite),
**deploy 32 s** — down from minutes, with the deploy no longer able to exceed a
tool timeout.
