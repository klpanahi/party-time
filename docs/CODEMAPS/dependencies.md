<!-- Generated: 2026-06-11 | Files scanned: 3 | Token estimate: ~200 -->

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
@testing-library/react ^16.3.2       Component testing
msw ^2.14.6                          API mocking in tests
```

## Invitee UI (npm)
Same stack as Admin UI — see `invitee_ui/package.json`

## Infrastructure
```
PostgreSQL    Primary datastore (local via docker-compose.yml)
SMS provider  Texts queued in `texts` table (external delivery not in this repo)
```

## Dev Tools
`public_backend/docker-compose.yml` — local Postgres
`dev.sh` — starts all three services (backend + both UIs)
