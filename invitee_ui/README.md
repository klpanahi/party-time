# invitee_ui

React frontend for the party-time invite page. Invitees visit `/invite/:id` to view event details and submit their RSVP.

## Running the dev server

```bash
npm install
npm run dev
```

Runs on port 5174. Requires the Go backend on port 8080.

## Testing

Tests use [Vitest](https://vitest.dev) + [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/) + [MSW](https://mswjs.io) for network mocking. No backend is needed — all API calls are intercepted in-process.

### Run in watch mode (during development)

```bash
npm test
```

### Run once (CI / pre-commit)

```bash
npm test -- --run
```

### Run with coverage report

```bash
npm run test:coverage
```

Coverage output lands in `coverage/`.

## Test structure

```
src/
  test/
    setup.js              # jest-dom matchers + MSW server lifecycle
    msw/
      handlers.js         # default GET /invite/:id and PUT /invite/:id handlers + shared fixtures
      server.js           # MSW Node server
  pages/
    InvitePage.test.jsx   # all InvitePage tests
```

Per-test handler overrides use `server.use(...)` inside the test body — MSW resets to the defaults after each test automatically.
