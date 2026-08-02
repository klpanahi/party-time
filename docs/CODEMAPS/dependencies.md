<!-- Generated: 2026-08-02 | Files scanned: 4 | Token estimate: ~240 -->

# Dependencies

## Backend (Go)
```
github.com/gin-gonic/gin v1.12.0       HTTP router + middleware
github.com/gin-contrib/cors v1.7.7     CORS middleware
github.com/jmoiron/sqlx v1.4.0        SQL query helper (db.Select, db.Get)
github.com/lib/pq v1.12.1             PostgreSQL driver
github.com/pressly/goose/v3 v3.27.3   Schema migration runner (embedded in binary via //go:embed)
github.com/twilio/twilio-go v1.30.9   Twilio SMS API client
```

## Admin UI (npm)
```
react / react-dom ^19.2.6             UI framework
react-router-dom ^7.17.0             Client-side routing
vite ^8.0.12                         Build tool / dev server
vitest ^4.1.8                        Test runner
@vitest/coverage-v8 ^4.1.8           Coverage reporter
@testing-library/react ^16.3.2       Component testing
@testing-library/jest-dom ^6.9.1     Custom matchers (toBeInTheDocument, etc.)
@testing-library/user-event ^14.6.1  User interaction simulation
msw ^2.14.6                          API mocking in tests
jsdom ^27.0.1                        Browser environment for Vitest
```

## Invitee UI (npm)
Same stack as Admin UI — see `invitee_ui/package.json`

## Infrastructure
```
PostgreSQL    Primary datastore (local via docker-compose.yml)
SMS provider  Texts queued in `texts` table (external delivery not in this repo)
```

## Dev Tools
```
docker-compose.yml      Local PostgreSQL container (postgres-db service, user=myuser, db=party_time)
run_local.sh            Starts all three services: backend (port 8080), admin UI (5173), invitee UI (5174)
                        Supports --no-reset to skip DB wipe and preserve UI-created state
public_backend/Dockerfile  Multi-stage cross-compile build (arm64 host → amd64 target);
                        includes build-time SHA injection; runtime image is alpine + tzdata
```
