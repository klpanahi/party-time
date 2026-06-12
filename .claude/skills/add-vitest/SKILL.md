---
name: add-vitest
description: Write Vitest + React Testing Library tests for the party-time admin_ui after a feature is added or changed. Brings per-file statement coverage to ~90%. Use when the user adds or modifies a React component, asks to write tests, says "add tests", or wants coverage improved on a specific file.
---

# Add Vitest Tests — admin_ui

## Workflow

1. **Identify what changed**
   Run `git diff HEAD` (or `git diff main...HEAD` for a branch). Read every `.jsx`/`.js` file that was touched. If the user points at a specific file, read that.

2. **Read the existing test file (if any)**
   Co-locate tests: `src/pages/Foo.jsx` → `src/pages/Foo.test.jsx`. Read it so you add to it rather than duplicating.

3. **Read `src/test/msw/handlers.js`**
   Understand what fixtures and handlers already exist before inventing new ones. Add new handlers/fixtures to this file when the feature needs endpoints that aren't there yet.

4. **Write the tests**
   Follow the patterns in [PATTERNS.md](PATTERNS.md). Cover:
   - Happy path (data loads and renders correctly)
   - Empty / zero states
   - User interactions (clicks, form submits, field changes)
   - Error states (API returns 4xx/5xx via `server.use(...)`)
   - Any conditional branches visible in the JSX

5. **Run and fix**
   ```
   npm run test -- --run
   ```
   Fix all failures before moving on.

6. **Check coverage and iterate**
   ```
   npm run test:coverage
   ```
   Read the `Uncovered Line #s` column for the changed file. Write additional tests until statements ≥ 90%. Skip:
   - `App.jsx` and `main.jsx` (entry points, not worth unit testing)
   - Catch blocks that require injecting fetch-level errors through fake timers — note them as acceptable gaps
   - `navigator.clipboard` calls (not available in jsdom)

7. **Confirm final run**
   Run `npm run test -- --run` one last time to confirm everything is green.

## Non-negotiable rules

- Never mock `src/api.js` directly — always intercept at the network layer with MSW
- Always wrap `vi.useFakeTimers()` tests: load the page first with real timers, then switch (see PATTERNS.md)
- `userEvent.click` already awaits async chains — use synchronous `expect()` after it, not `waitForElementToBeRemoved`
- `onUnhandledRequest: 'error'` is set globally — every endpoint a component fetches must have a handler or the test will throw

See [PATTERNS.md](PATTERNS.md) for code templates and pitfall details.
