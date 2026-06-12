---
name: add-vitest-patterns
description: Code patterns and pitfalls reference for the add-vitest skill.
---

# Vitest Patterns — admin_ui

## Stack

| Package | Version |
|---|---|
| vitest | 4.1.8 |
| @vitest/coverage-v8 | 4.1.8 (must match vitest exactly) |
| @testing-library/react | 16.x |
| @testing-library/user-event | 14.x |
| @testing-library/jest-dom | 6.x |
| msw | 2.x |
| jsdom | 27.x |

## Standard test file skeleton

```jsx
import React from 'react'
import { render, screen, within, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { server } from '../test/msw/server'
import { BASE, defaultXxx, XXX_ID } from '../test/msw/handlers'
import MyComponent from './MyComponent'

function renderComponent() {
  return render(
    <MemoryRouter initialEntries={['/path']}>
      <Routes>
        <Route path="/path" element={<MyComponent />} />
        <Route path="/other" element={<div>Other Page</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('MyComponent', () => {
  afterEach(() => vi.useRealTimers()) // always reset fake timers

  it('...', async () => { ... })
})
```

## MSW: overriding a handler for one test

```js
server.use(
  http.get(`${BASE}/events`, () =>
    HttpResponse.json({ error: 'boom' }, { status: 500 })
  )
)
```

`afterEach(() => server.resetHandlers())` runs automatically via `src/test/setup.js` — the override is automatically cleaned up after each test.

## MSW: adding a new fixture/handler

Edit `src/test/msw/handlers.js`. Export the fixture so tests can import and override it:

```js
export const defaultWidgets = [{ id: 'w-1', name: 'Widget A' }]

// inside the handlers array:
http.get(`${BASE}/widgets`, () => HttpResponse.json(defaultWidgets)),
```

## Async rendering — waiting for data to load

```js
await screen.findByText('Summer Party')        // by text content
await screen.findByDisplayValue('Central Park') // by input value
await screen.findByRole('button', { name: /launch event/i })
```

## Fake timers — the correct pattern

**Wrong** (hangs: findBy polling is blocked by fake timers):
```js
vi.useFakeTimers()
renderComponent()
await screen.findByDisplayValue('Summer Party') // HANGS
```

**Correct** (load with real timers first, then switch):
```js
renderComponent()
await screen.findByDisplayValue('Summer Party') // real timers — works

vi.useFakeTimers()
fireEvent.change(input, { target: { value: 'new value' } })

await act(async () => {
  await vi.advanceTimersByTimeAsync(1000) // advance past the debounce
})

expect(screen.getByText('Saved')).toBeInTheDocument() // sync assertion after act
```

Use `fireEvent.change` (not `userEvent.type`) when fake timers are active — `userEvent` has internal delays that conflict with fake timers.

## After userEvent.click — modal close assertions

`userEvent.click` awaits the full async chain (fetch + state updates + re-render). By the time it resolves the modal is already gone. Use a synchronous `expect`, not `waitForElementToBeRemoved`:

```js
// CORRECT
await userEvent.click(screen.getByRole('button', { name: /save/i }))
expect(screen.queryByRole('heading', { name: /modal title/i })).not.toBeInTheDocument()

// WRONG — throws "element already removed"
await userEvent.click(screen.getByRole('button', { name: /save/i }))
await waitForElementToBeRemoved(() => screen.queryByRole('heading', { name: /modal title/i }))
```

## Common query patterns

```js
// By label text (form inputs)
screen.getByLabelText(/first name/i)

// By button accessible name
screen.getByRole('button', { name: /add contact/i })

// By current input value
screen.getByDisplayValue('Summer Party')

// By textarea placeholder
screen.getByPlaceholderText(/type your message/i)

// Scoped to a table row
const row = screen.getByText('Alice').closest('tr')
within(row).getByRole('button', { name: /edit/i })
```

## Coverage checklist per component

Run `npm run test:coverage` and look at the `Uncovered Line #s` column. Write tests until statements ≥ 90%.

| Gap type | How to fill it |
|---|---|
| Empty list state | `server.use(http.get(..., () => HttpResponse.json([])))` |
| API error banner | Return `{ status: 500 }` from the relevant handler |
| Modal open | `userEvent.click` the trigger, then `findByRole('heading', ...)` |
| Modal cancel | Click Cancel, assert heading gone |
| Auto-save debounce | Fake timers pattern above |
| Sub-component untested | Treat it as its own nested `describe` block |
| Dead code branch | Note in PR description, do not invent unreachable tests |

## Known jsdom limitations (acceptable skips)

- `navigator.clipboard.writeText` — not in jsdom; copy-link buttons cannot be tested
- `window.matchMedia` — mock needed for CSS media queries if used
- `ResizeObserver` — mock needed if a component uses it
