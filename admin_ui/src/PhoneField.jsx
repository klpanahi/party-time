// PhoneField is the phone input shared by every form that takes a number. The
// value is whatever the user typed; the form normalizes it on submit and passes
// back an error to show under the field when it won't parse.
export default function PhoneField({ value, onChange, error }) {
  return (
    <label>Phone Number
      <input
        required
        type="tel"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'phone-error' : undefined}
      />
      {error && <span id="phone-error" className="field-error" role="alert">{error}</span>}
    </label>
  )
}
