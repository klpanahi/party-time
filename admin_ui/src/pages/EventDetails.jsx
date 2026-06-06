import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getEvent, updateEvent, addInvitee, sendMessage, getContacts } from '../api'
import { toDatetimeLocal } from '../dateUtils'

export default function EventDetails() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)
  const [showAddInvitee, setShowAddInvitee] = useState(false)
  const [messageContent, setMessageContent] = useState('')
  const [sending, setSending] = useState(false)
  const saveTimer = useRef(null)

  useEffect(() => {
    getEvent(id)
      .then((data) => setDetail({
        ...data,
        event: { ...data.event, date: toDatetimeLocal(data.event.date) },
      }))
      .catch((e) => setError(e.message))
  }, [id])

  function scheduleAutoSave(updatedEvent) {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try {
        await updateEvent(id, {
          name: updatedEvent.name,
          date: updatedEvent.date,
          description: updatedEvent.description,
          location: updatedEvent.location,
          plus_ones_allowed: updatedEvent.plus_ones_allowed,
        })
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      } catch (e) {
        setError(e.message)
      }
    }, 800)
  }

  function updateField(field, value) {
    setDetail((prev) => {
      const updated = { ...prev, event: { ...prev.event, [field]: value } }
      scheduleAutoSave(updated.event)
      return updated
    })
  }

  async function handleInviteeAdded() {
    const fresh = await getEvent(id)
    setDetail(fresh)
    setShowAddInvitee(false)
  }

  async function handleSendMessage(ev) {
    ev.preventDefault()
    if (!messageContent.trim()) return
    setSending(true)
    try {
      await sendMessage(id, messageContent)
      setMessageContent('')
    } catch (e) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  if (error) return <div className="page"><div className="error-banner">{error}</div></div>
  if (!detail) return <div className="page loading">Loading…</div>

  const { event, invitees } = detail

  return (
    <div className="page">
      <header className="page-header">
        <button className="btn-ghost" onClick={() => navigate('/')}>← Back</button>
        {saved && <span className="save-indicator">Saved</span>}
      </header>

      {/* Event Details Block */}
      <section className="card">
        <h2 className="card-title">Event Details</h2>
        <div className="form">
          <label>Name
            <input value={event.name} onChange={(e) => updateField('name', e.target.value)} />
          </label>
          <label>Date &amp; Time
            <input type="datetime-local" value={event.date}
              onChange={(e) => updateField('date', e.target.value)} />
          </label>
          <label>Location
            <input value={event.location} onChange={(e) => updateField('location', e.target.value)} />
          </label>
          <label>Description
            <textarea value={event.description} onChange={(e) => updateField('description', e.target.value)} rows={4} />
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={event.plus_ones_allowed}
              onChange={(e) => updateField('plus_ones_allowed', e.target.checked)} />
            Plus ones allowed
          </label>
        </div>
      </section>

      {/* Invitees Block */}
      <section className="card">
        <div className="card-header-row">
          <h2 className="card-title">Invitees ({invitees.length})</h2>
          <button className="btn-primary" onClick={() => setShowAddInvitee(true)}>+ Add Invitee</button>
        </div>

        {showAddInvitee && (
          <AddInviteeModal
            eventId={id}
            alreadyInvited={invitees.map((i) => i.contact_id)}
            onAdded={handleInviteeAdded}
            onClose={() => setShowAddInvitee(false)}
          />
        )}

        {invitees.length === 0
          ? <p className="empty">No invitees yet.</p>
          : (
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>RSVP</th>
                  <th>+Guests</th>
                  <th>Invite Link</th>
                </tr>
              </thead>
              <tbody>
                {invitees.map((inv) => (
                  <tr key={inv.id}>
                    <td>{inv.first_name} {inv.last_name}</td>
                    <td className="mono">{inv.phone_number}</td>
                    <td><RSVPBadge status={inv.rsvp_status} /></td>
                    <td>{inv.additional_guests > 0 ? `+${inv.additional_guests}` : '—'}</td>
                    <td><InviteLink url={inv.invite_url} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </section>

      {/* Send Message Block */}
      <section className="card">
        <h2 className="card-title">Send a Message</h2>
        <p className="hint">Message will be sent to all invitees who haven't declined.</p>
        <form onSubmit={handleSendMessage} className="message-form">
          <textarea
            value={messageContent}
            onChange={(e) => setMessageContent(e.target.value)}
            placeholder="Type your message…"
            rows={4}
          />
          <button type="submit" className="btn-primary" disabled={sending || !messageContent.trim()}>
            {sending ? 'Sending…' : 'Send'}
          </button>
        </form>
      </section>
    </div>
  )
}

function AddInviteeModal({ eventId, alreadyInvited, onAdded, onClose }) {
  const [contacts, setContacts] = useState([])
  const [search, setSearch] = useState('')
  const [mode, setMode] = useState('pick') // 'pick' | 'new'
  const [newForm, setNewForm] = useState({ first_name: '', last_name: '', phone_number: '' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    getContacts().then(setContacts).catch((e) => setError(e.message))
  }, [])

  const filtered = contacts.filter((c) => {
    if (alreadyInvited.includes(c.id)) return false
    const q = search.toLowerCase()
    return (
      c.first_name.toLowerCase().includes(q) ||
      c.last_name.toLowerCase().includes(q) ||
      c.phone_number.includes(q)
    )
  })

  async function selectContact(contact) {
    setSubmitting(true)
    try {
      await addInvitee(eventId, { contact_id: contact.id })
      onAdded()
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCreateNew(ev) {
    ev.preventDefault()
    setSubmitting(true)
    try {
      await addInvitee(eventId, newForm)
      onAdded()
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header-row">
          <h2>Add Invitee</h2>
          <div className="tab-toggle">
            <button className={mode === 'pick' ? 'tab active' : 'tab'} onClick={() => setMode('pick')}>
              From Contacts
            </button>
            <button className={mode === 'new' ? 'tab active' : 'tab'} onClick={() => setMode('new')}>
              New Contact
            </button>
          </div>
        </div>

        {error && <div className="error-banner">{error}</div>}

        {mode === 'pick' && (
          <>
            <input
              className="search-input"
              placeholder="Search by name or phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
            <div className="contact-list">
              {contacts.length === 0 && <p className="empty">Loading contacts…</p>}
              {contacts.length > 0 && filtered.length === 0 && (
                <p className="empty">
                  No contacts match.{' '}
                  <button className="link-btn" onClick={() => setMode('new')}>Create a new one?</button>
                </p>
              )}
              {filtered.map((c) => (
                <button
                  key={c.id}
                  className="contact-row"
                  onClick={() => selectContact(c)}
                  disabled={submitting}
                >
                  <span className="contact-name">{c.first_name} {c.last_name}</span>
                  <span className="contact-phone mono">{c.phone_number}</span>
                </button>
              ))}
            </div>
            <div className="form-actions">
              <button className="btn-ghost" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}

        {mode === 'new' && (
          <form onSubmit={handleCreateNew} className="form">
            <label>First Name
              <input required value={newForm.first_name}
                onChange={(e) => setNewForm({ ...newForm, first_name: e.target.value })} autoFocus />
            </label>
            <label>Last Name
              <input value={newForm.last_name}
                onChange={(e) => setNewForm({ ...newForm, last_name: e.target.value })} />
            </label>
            <label>Phone Number
              <input required value={newForm.phone_number}
                onChange={(e) => setNewForm({ ...newForm, phone_number: e.target.value })} />
            </label>
            <div className="form-actions">
              <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={submitting}>
                {submitting ? 'Adding…' : 'Add & Invite'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

function InviteLink({ url }) {
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="invite-link-cell">
      <a href={url} target="_blank" rel="noreferrer" className="invite-link mono">{url}</a>
      <button className="copy-btn" onClick={copy} title="Copy link">
        {copied ? '✓' : 'Copy'}
      </button>
    </div>
  )
}

function RSVPBadge({ status }) {
  const cls = {
    'Accepted': 'badge-accepted',
    'Tentative': 'badge-tentative',
    'Declined': 'badge-declined',
    'No Response': 'badge-none',
  }[status] || 'badge-none'
  return <span className={`badge ${cls}`}>{status}</span>
}
