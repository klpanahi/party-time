import { parsePhoneNumberFromString } from 'libphonenumber-js/max'

// Numbers typed without a country code are read as US numbers. Matches
// defaultPhoneRegion in the backend's phone.go.
const DEFAULT_COUNTRY = 'US'

export const PHONE_ERROR = "Couldn't read that as a phone number. Please re-enter it."

// normalizePhone turns a number typed in any format ("(512) 350-0064",
// "512.350.0064", "+1 512 350 0064", ...) into the E.164 form the backend
// stores ("+15123500064"). Returns null when it isn't a real phone number, so
// the form can say so before anything is sent. The backend runs the same check
// and is the final word; this just keeps the round trip out of the common case.
//
// Invisible formatting characters are dropped first: a number copied out of
// macOS Contacts arrives wrapped in U+202D/U+202C direction marks.
export function normalizePhone(raw) {
  const cleaned = (raw ?? '').replace(/\p{Cf}/gu, '').trim()
  const phone = parsePhoneNumberFromString(cleaned, DEFAULT_COUNTRY)
  return phone?.isValid() ? phone.number : null
}

// formatPhone is how every phone number is shown: international format, e.g.
// "+1 512 350 0064". Anything that won't parse (a number saved before
// normalization existed) is shown as stored rather than hidden.
export function formatPhone(stored) {
  const phone = parsePhoneNumberFromString(stored ?? '', DEFAULT_COUNTRY)
  return phone ? phone.formatInternational() : (stored ?? '')
}

// phoneMatches is the contact search: a query with digits in it matches any
// number containing those digits, however either side is punctuated, so
// "(512) 350" finds "+15123500064".
export function phoneMatches(stored, query) {
  const digits = query.replace(/\D/g, '')
  return digits !== '' && (stored ?? '').replace(/\D/g, '').includes(digits)
}
