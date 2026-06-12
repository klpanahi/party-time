<!-- Generated: 2026-06-11 | Files scanned: 3 | Token estimate: ~220 -->

# Dependencies

## Backend (Go)
```
github.com/gin-gonic/gin v1.12.0       HTTP router + middleware
github.com/gin-contrib/cors v1.7.7     CORS middleware
github.com/jmoiron/sqlx v1.4.0        SQL query helper (db.Select, db.Get)
github.com/lib/pq v1.12.1             PostgreSQL driver
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
`docker-compose.yml` (repo root) — local Postgres
`run_local.sh` (repo root) — starts all three services (backend + both UIs)
