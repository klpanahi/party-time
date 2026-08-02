# Setting the datetime-local field

## What does not work

Chrome renders `<input type="datetime-local">` as shadow-DOM spinbutton
segments (month / day / year / hours / minutes / AM-PM). CDP cannot reach them:

| Attempt | Result |
|---|---|
| `fill_form` / `fill` on the input | Reports success, value stays `""`, `invalid="true"` |
| `fill_form` on the individual segment uids | `Error: element did not become interactive within the configured timeout` |
| `click` the input, then `type_text` | Reports typed, value stays `""` — `type_text` uses `Input.insertText`, which the segments ignore |
| `click`, then `press_key` per digit | Reports success per key, value stays `""` |

The failure is silent: every tool reports success while the value stays empty.
Always read the value back before submitting.

## What works

Set the value through the native `HTMLInputElement` setter, then dispatch a
bubbling `input` event. React overrides the `value` property on its controlled
inputs, so assigning `input.value` directly does not notify React — going
through the prototype setter does, and the event drives the real `onChange`.

```js
() => {
  const input = document.querySelector('input[type="datetime-local"]');
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  ).set;
  setter.call(input, '2026-08-15T18:00');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return { value: input.value, valid: input.validity.valid };
}
```

Run it with `evaluate_script`. Proceed only when it returns
`{"value": "2026-08-15T18:00", "valid": true}`.

The format must be `YYYY-MM-DDTHH:MM`, 24-hour, no seconds and no timezone.
The backend parses it as `America/Chicago` regardless of the browser's timezone.

## Why this is acceptable

It bypasses only Chrome's date-picker widget. React's `onChange`, the
component's state, form validation, and the real `POST /admin/events` through
nginx all still run — so the deployment is still genuinely exercised. If the
goal is specifically to test the date widget's own behaviour, this workaround
does not cover it; drive it manually instead.
