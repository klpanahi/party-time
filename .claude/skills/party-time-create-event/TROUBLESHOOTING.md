# Troubleshooting event creation

Always read the POST response body via `get_network_request` before diagnosing.
The UI renders one generic message for several distinct causes.

## 400 `invalid date format, expected YYYY-MM-DDTHH:MM`

This message is misleading. `createEvent` in `public_backend/admin_handlers.go`
maps **any** error from `parseCentralTime()` to it, including errors that have
nothing to do with the string's format.

**First check the request body you actually sent.** If it already reads
`"date":"2026-08-15T18:00"`, the format is fine and the real cause is below.

### Known cause: missing tzdata in the backend container

`parseCentralTime()` starts with `time.LoadLocation("America/Chicago")`, which
reads the IANA database from `/usr/share/zoneinfo`. The production image is
built `FROM alpine:latest` and installs only `ca-certificates`, so that path
does not exist and `LoadLocation` fails on every request — every event create
and every event update returns this 400.

Confirm on the docker VM:

```bash
ssh ubuntu@docker.local 'docker exec party-time-admin ls /usr/share/zoneinfo'
```

`No such file or directory` confirms it.

**Fix** — add tzdata to the runtime stage of `public_backend/Dockerfile`:

```dockerfile
RUN apk --no-cache add ca-certificates tzdata
```

Alternatively `import _ "time/tzdata"` in the Go backend to embed the database
in the binary, which keeps the image minimal and removes the runtime dependency
entirely.

Rebuild and redeploy from the party-time repo:

```bash
cd /path/to/party-time
ANSIBLE_CONFIG=~/Documents/Workspace/homelab/ansible/ansible.cfg \
  ansible-playbook deploy/party-time.yml -e party_time_repo=$PWD
```

**Why local tests miss it:** developer machines and the CI containers used by
`build.sh` have tzdata present, so `parseCentralTime` succeeds there. The bug
only appears in the deployed Alpine image. A test asserting `LoadLocation`
succeeds would not catch it either unless it runs inside that image.

## 404 on `/admin`

nginx served the SPA instead of proxying. Check `nginx_upstreams` and the
`location /admin` block in `deploy/nginx/admin.conf` in this repo, and that
the admin backend is up on `docker.local:8081`.

## 502 / 504

nginx cannot reach the upstream. Either the `party-time-admin` container is
down, or `docker.local` is not resolving from the nginx VM — mDNS needs
`avahi-daemon` and `libnss-mdns`, installed by `site.yml`.

## Empty events list after a successful create

`GET /admin/events` returning `[]` on a fresh database is correct, not an error.
Confirm the create's own POST returned 2xx before treating this as a fault.
