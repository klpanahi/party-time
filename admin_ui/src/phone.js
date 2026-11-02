import { parsePhoneNumberFromString } from 'libphonenumber-js/max'

// Numbers typed without a country code are read as US numbers. Matches
// DefaultRegion in the backend's phone package.
const DEFAULT_COUNTRY = 'US'

export const PHONE_ERROR = "Couldn't read that as a phone number. Please re-enter it."

// parse is the shared validity rule. Invisible formatting characters are
// dropped first: a number copied out of macOS Contacts arrives wrapped in
// U+202D/U+202C direction marks.
function parse(raw) {
  const cleaned = (raw ?? '').replace(/\p{Cf}/gu, '').trim()
  const phone = parsePhoneNumberFromString(cleaned, DEFAULT_COUNTRY)
  return phone?.isValid() ? phone : null
}

// canonical is the one form stored and shown for every contact, the same
// string the backend's phone.Normalize produces: "+1 (512)350-0064" for a +1
// (North American) number, international format ("+44 20 7946 0958") otherwise.
function canonical(phone) {
  const n = phone.nationalNumber
  if (phone.countryCallingCode === '1' && n.length === 10) {
    return `+1 (${n.slice(0, 3)})${n.slice(3, 6)}-${n.slice(6)}`
  }
  return phone.formatInternational()
}

// normalizePhone turns a number typed in any format ("(512) 350-0064",
// "512.350.0064", "+15123500064", ...) into the canonical form the backend
// stores. Returns null when it isn't a real phone number, so the form can say
// so before anything is sent. The backend runs the same check and is the final
// word; this just keeps the round trip out of the common case.
export function normalizePhone(raw) {
  const phone = parse(raw)
  return phone ? canonical(phone) : null
}

// formatPhone is how every phone number is shown. Stored numbers are already
// canonical; this also covers one saved before normalization existed. Anything
// that won't parse is shown as stored rather than hidden.
export function formatPhone(stored) {
  return normalizePhone(stored) ?? (stored ?? '')
}

// phoneMatches is the contact search: a query with digits in it matches any
// number containing those digits, however either side is punctuated, so
// "512 350" finds "+1 (512)350-0064".
export function phoneMatches(stored, query) {
  const digits = query.replace(/\D/g, '')
  return digits !== '' && (stored ?? '').replace(/\D/g, '').includes(digits)
}
