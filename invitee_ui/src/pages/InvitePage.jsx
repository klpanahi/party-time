import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

const BASE = 'http://localhost:8080'

async function fetchInvite(id) {
  const res = await fetch(`${BASE}/invite/${id}`)
  if (!res.ok) throw new Error('Invite not found')
  return res.json()
}

async function saveRSVP(id, rsvp_status, additional_guests) {
  const res = await fetch(`${BASE}/invite/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rsvp_status, additional_guests }),
  })
  if (!res.ok) throw new Error('Failed to save')
}

function formatEventDate(isoString) {
  if (!isoString) return ''
  const d = new Date(isoString)
  if (isNaN(d)) return isoString
  return d.toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

const RSVP_OPTIONS = [
  { value: 'Accepted',    label: 'Attending',     icon: '✓' },
  { value: 'Tentative',   label: 'Maybe',         icon: '?' },
  { value: 'Declined',    label: 'Can\'t make it', icon: '✕' },
]

export default function InvitePage() {
  const { id } = useParams()
  const [invite, setInvite] = useState(null)
  const [rsvp, setRsvp] = useState('No Response')
  const [guests, setGuests] = useState(0)
  const [status, setStatus] = useState('idle') // 'idle' | 'saving' | 'saved' | 'error'
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchInvite(id)
      .then((data) => {
        setInvite(data)
        setRsvp(data.rsvp_status)
        setGuests(data.additional_guests)
      })
      .catch((e) => setError(e.message))
  }, [id])

  async function handleRSVP(value) {
    setRsvp(value)
    await persist(value, guests)
  }

  async function handleGuestChange(delta) {
    const next = Math.max(0, guests + delta)
    setGuests(next)
    await persist(rsvp, next)
  }

  async function persist(rsvp_status, additional_guests) {
    setStatus('saving')
    try {
      await saveRSVP(id, rsvp_status, additional_guests)
      setStatus('saved')
      setTimeout(() => setStatus('idle'), 2000)
    } catch (e) {
      setStatus('error')
      setError(e.message)
    }
  }

  if (error) {
    return (
      <div className="screen">
        <div className="error-card">
          <p className="error-icon">✕</p>
          <p>{error}</p>
        </div>
      </div>
    )
  }

  if (!invite) {
    return (
      <div className="screen">
        <div className="loading-pulse">Loading your invitation…</div>
      </div>
    )
  }

  const isPast = new Date(invite.event_date) < new Date()
  const declined = rsvp === 'Declined'

  return (
    <div className="screen">
      <div className="invite-card">

        {/* Header greeting */}
        <div className="invite-header">
          <p className="greeting">Hi {invite.first_name}! 👋</p>
          <h1 className="event-title">{invite.event_name}</h1>
        </div>

        {/* Event details */}
        <div className="event-details">
          <DetailRow icon="📅" text={formatEventDate(invite.event_date)} />
          <DetailRow icon="📍" text={invite.event_location} />
          {invite.event_description && (
            <DetailRow icon="📝" text={invite.event_description} />
          )}
        </div>

        <hr className="divider" />

        {isPast ? (
          <div className="past-notice">
            This event has already taken place. Your RSVP can no longer be modified.
          </div>
        ) : (
          <>
            {/* RSVP */}
            <div className="rsvp-section">
              <p className="section-label">Will you be there?</p>
              <div className="rsvp-buttons">
                {RSVP_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    className={`rsvp-btn rsvp-${opt.value.toLowerCase()} ${rsvp === opt.value ? 'selected' : ''}`}
                    onClick={() => handleRSVP(opt.value)}
                  >
                    <span className="rsvp-icon">{opt.icon}</span>
                    <span className="rsvp-label">{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Plus ones — only show if allowed and not declined */}
            {invite.plus_ones_allowed && !declined && (
              <>
                <hr className="divider" />
                <div className="guests-section">
                  <p className="section-label">Additional guests</p>
                  <div className="guest-counter">
                    <button
                      className="counter-btn"
                      onClick={() => handleGuestChange(-1)}
                      disabled={guests === 0}
                    >−</button>
                    <span className="guest-count">{guests}</span>
                    <button
                      className="counter-btn"
                      onClick={() => handleGuestChange(1)}
                    >+</button>
                  </div>
                </div>
              </>
            )}

            {/* Save status */}
            <div className="save-status" aria-live="polite">
              {status === 'saving' && <span className="status-saving">Saving…</span>}
              {status === 'saved'  && <span className="status-saved">Saved ✓</span>}
              {status === 'error'  && <span className="status-error">Couldn't save, try again</span>}
            </div>
          </>
        )}

      </div>
    </div>
  )
}

function DetailRow({ icon, text }) {
  return (
    <div className="detail-row">
      <span className="detail-icon">{icon}</span>
      <span className="detail-text">{text}</span>
    </div>
  )
}
