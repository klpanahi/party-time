// Convert an ISO date string to the value format required by <input type="datetime-local">
export function toDatetimeLocal(isoString) {
  if (!isoString) return ''
  const d = new Date(isoString)
  if (isNaN(d)) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Short display format for the events table: "Mar 7, 2025 6:00 PM"
export function formatDateShort(isoString) {
  if (!isoString) return '—'
  const d = new Date(isoString)
  if (isNaN(d)) return '—'
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

// Long format used in invite texts: "Monday, March 7, 2025 at 6:00 PM".
// Matches the backend's default invite (defaultInviteTemplate in admin_handlers.go).
export function formatDateLong(isoString) {
  if (!isoString) return ''
  const d = new Date(isoString)
  if (isNaN(d)) return ''
  return d.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })
}
