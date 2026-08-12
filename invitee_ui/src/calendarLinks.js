// Calendar entries are built entirely in the browser rather than served from a
// backend route. A path like /invite/:id/calendar.ics would match the SPA-vs-API
// Accept-header split in deploy/nginx/public.conf, so a direct browser navigation
// to it would be answered with index.html instead of the file.

const PRODID = '-//party-time//invite//EN'

// RFC 5545 basic-format UTC timestamp: 20260814T230000Z
// Guarded before constructing, because new Date(null) is the epoch rather than
// an invalid date — a missing end time would otherwise look parseable.
function toICSDate(value) {
  if (value === null || value === undefined || value === '') return ''
  const d = new Date(value)
  if (isNaN(d)) return ''
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

// Backslash, semicolon and comma are field separators in RFC 5545, and literal
// newlines end a property, so all four have to be escaped inside a TEXT value.
function escapeICSText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
}

// RFC 5545 caps a content line at 75 octets; longer lines continue on the next
// line prefixed with a single space.
function foldLine(line) {
  if (line.length <= 75) return line
  const parts = [line.slice(0, 75)]
  let rest = line.slice(75)
  while (rest.length > 74) {
    parts.push(' ' + rest.slice(0, 74))
    rest = rest.slice(74)
  }
  if (rest.length) parts.push(' ' + rest)
  return parts.join('\r\n')
}

// True when the invite carries enough to build a calendar entry at all.
export function hasCalendarData(invite) {
  return Boolean(invite && toICSDate(invite.event_date) && toICSDate(invite.event_end_time))
}

export function buildICS(invite) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${invite.invite_id}@party-time`,
    `DTSTAMP:${toICSDate(Date.now())}`,
    `DTSTART:${toICSDate(invite.event_date)}`,
    `DTEND:${toICSDate(invite.event_end_time)}`,
    `SUMMARY:${escapeICSText(invite.event_name)}`,
  ]

  if (invite.event_location) lines.push(`LOCATION:${escapeICSText(invite.event_location)}`)
  if (invite.event_description) lines.push(`DESCRIPTION:${escapeICSText(invite.event_description)}`)

  lines.push('END:VEVENT', 'END:VCALENDAR')

  return lines.map(foldLine).join('\r\n')
}

export function buildGoogleCalendarUrl(invite) {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: invite.event_name ?? '',
    dates: `${toICSDate(invite.event_date)}/${toICSDate(invite.event_end_time)}`,
  })
  if (invite.event_description) params.set('details', invite.event_description)
  if (invite.event_location) params.set('location', invite.event_location)

  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

// Filenames land in the invitee's downloads folder, so keep them to a safe subset.
export function icsFilename(invite) {
  const slug = String(invite.event_name ?? 'event')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'event'}.ics`
}
