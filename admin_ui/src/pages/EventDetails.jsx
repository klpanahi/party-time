import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getEvent, updateEvent, addInvitee, sendMessage, getContacts, launchEvent, getTexts, resendText, cancelEvent, deleteEvent } from '../api'
import { toDatetimeLocal, formatDateShort } from '../dateUtils'

const STATUS_LABELS = {
  draft: 'Draft',
  launched: 'Launched',
  canceled: 'Canceled',
}

// Starting point for the cancellation notice. The admin edits this in the modal
// and the edited text is what actually gets queued — nothing is sent unreviewed.
function defaultCancellationMessage(event) {
  return `Unfortunately, ${event.name} on ${formatDateShort(event.date)} has been canceled. `
    + `Sorry for the inconvenience — we hope to see you at the next one!`
}

export default function EventDetails() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)
  const [activeTab, setActiveTab] = useState('invitees')
  const [showAddInvitee, setShowAddInvitee] = useState(false)
  const [showLaunch, setShowLaunch] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [showCancel, setShowCancel] = useState(false)
  const [canceling, setCanceling] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [messageContent, setMessageContent] = useState('')
  const [sending, setSending] = useState(false)
  const [texts, setTexts] = useState(null)
  const [textsError, setTextsError] = useState(null)
  const saveTimer = useRef(null)
  const messageRef = useRef(null)
  const messageSectionRef = useRef(null)

  useEffect(() => {
    getEvent(id)
      .then((data) => setDetail({
        ...data,
        event: { ...data.event, date: toDatetimeLocal(data.event.date) },
      }))
      .catch((e) => setError(e.message))
  }, [id])

  useEffect(() => {
    if (activeTab === 'messages') {
      setTextsError(null)
      getTexts(id)
        .then(setTexts)
        .catch((e) => setTextsError(e.message))
    }
  }, [activeTab, id])

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
    setDetail({
      ...fresh,
      event: { ...fresh.event, date: toDatetimeLocal(fresh.event.date) },
    })
    setShowAddInvitee(false)
  }

  async function handleLaunch() {
    setLaunching(true)
    try {
      await launchEvent(id)
      setDetail((prev) => ({ ...prev, event: { ...prev.event, status: 'launched' } }))
      setShowLaunch(false)
      // Refresh texts if the tab is already open
      if (activeTab === 'messages') {
        getTexts(id).then(setTexts).catch((e) => setTextsError(e.message))
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLaunching(false)
    }
  }

  async function handleCancel(content) {
    setCanceling(true)
    try {
      await cancelEvent(id, content)
      setDetail((prev) => ({ ...prev, event: { ...prev.event, status: 'canceled' } }))
      setShowCancel(false)
      if (activeTab === 'messages') {
        getTexts(id).then(setTexts).catch((e) => setTextsError(e.message))
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setCanceling(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteEvent(id)
      navigate('/')
    } catch (e) {
      setError(e.message)
      setDeleting(false)
    }
  }

  function handleNotifyChanges() {
    setMessageContent("Heads up — some event details have been updated. Check your invite link for the latest info.")
    setActiveTab('invitees')
    setTimeout(() => {
      messageSectionRef.current?.scrollIntoView({ behavior: 'smooth' })
      messageRef.current?.focus()
    }, 50)
  }

  async function handleSendMessage(ev) {
    ev.preventDefault()
    if (!messageContent.trim()) return
    setSending(true)
    try {
      await sendMessage(id, messageContent)
      setMessageContent('')
      // Refresh texts list if that tab is open
      if (activeTab === 'messages') {
        getTexts(id).then(setTexts).catch((e) => setTextsError(e.message))
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  if (error) return <div className="page"><div className="error-banner">{error}</div></div>
  if (!detail) return <div className="page loading">Loading…</div>

  const { event, invitees } = detail
  const canceled = event.status === 'canceled'

  return (
    <div className="page">
      <header className="page-header">
        <button className="btn-ghost" onClick={() => navigate('/')}>← Back</button>
        <div className="header-right">
          {saved && <span className="save-indicator">Saved</span>}
          <span className={`status-badge status-${event.status}`}>
            {STATUS_LABELS[event.status] ?? event.status}
          </span>
          {event.status === 'draft' && (
            <button className="btn-launch" onClick={() => setShowLaunch(true)}>
              Launch Event
            </button>
          )}
          {event.status === 'launched' && (
            <button className="btn-danger-ghost" onClick={() => setShowCancel(true)}>
              Cancel Event
            </button>
          )}
          {/* Deleting a launched event would strand invitees holding a live
              link, so it's offered only before launch or after cancellation. */}
          {(event.status === 'draft' || canceled) && (
            <button className="btn-danger-ghost" onClick={() => setShowDelete(true)}>
              Delete Event
            </button>
          )}
        </div>
      </header>

      {canceled && (
        <div className="cancel-banner">
          This event was canceled{event.canceled_at ? ` on ${formatDateShort(event.canceled_at)}` : ''}.
          Its details and invitee list are now read-only.
        </div>
      )}

      {showLaunch && (
        <LaunchModal
          inviteeCount={invitees.length}
          launching={launching}
          onConfirm={handleLaunch}
          onClose={() => setShowLaunch(false)}
        />
      )}

      {showCancel && (
        <CancelModal
          event={event}
          inviteeCount={invitees.length}
          canceling={canceling}
          onConfirm={handleCancel}
          onClose={() => setShowCancel(false)}
        />
      )}

      {showDelete && (
        <DeleteModal
          event={event}
          deleting={deleting}
          onConfirm={handleDelete}
          onClose={() => setShowDelete(false)}
        />
      )}

      {/* Event Details */}
      <section className="card">
        <div className="card-header-row">
          <h2 className="card-title">Event Details</h2>
          {event.status === 'launched' && (
            <button className="btn-ghost" onClick={handleNotifyChanges}>
              Notify invitees of changes
            </button>
          )}
        </div>
        <div className="form">
          <label>Name
            <input value={event.name} disabled={canceled} onChange={(e) => updateField('name', e.target.value)} />
          </label>
          <label>Date &amp; Time
            <input type="datetime-local" value={event.date} disabled={canceled}
              onChange={(e) => updateField('date', e.target.value)} />
          </label>
          <label>Location
            <input value={event.location} disabled={canceled} onChange={(e) => updateField('location', e.target.value)} />
          </label>
          <label>Description
            <textarea value={event.description} disabled={canceled}
              onChange={(e) => updateField('description', e.target.value)} rows={4} />
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={event.plus_ones_allowed} disabled={canceled}
              onChange={(e) => updateField('plus_ones_allowed', e.target.checked)} />
            Plus ones allowed
          </label>
        </div>
      </section>

      {/* Tabs */}
      <div className="page-tabs">
        <button
          className={`page-tab ${activeTab === 'invitees' ? 'active' : ''}`}
          onClick={() => setActiveTab('invitees')}
        >
          Invitees ({invitees.length})
        </button>
        <button
          className={`page-tab ${activeTab === 'messages' ? 'active' : ''}`}
          onClick={() => setActiveTab('messages')}
        >
          Messages
        </button>
      </div>

      {activeTab === 'invitees' && (
        <>
          <section className="card">
            <div className="card-header-row">
              <h2 className="card-title">Invitees ({invitees.length})</h2>
              {!canceled && (
                <button className="btn-primary" onClick={() => setShowAddInvitee(true)}>+ Add Invitee</button>
              )}
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
                      <th>Opened</th>
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
                        <td>{inv.opened_at
                          ? <span className="opened-at">{formatDateShort(inv.opened_at)}</span>
                          : <span className="not-opened">Not yet</span>}
                        </td>
                        <td><InviteLink url={inv.invite_url} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </section>

          {!canceled && (
            <section className="card" ref={messageSectionRef}>
              <h2 className="card-title">Send a Message</h2>
              <p className="hint">Message will be sent to all invitees who haven't declined. Each message will automatically include their personal RSVP link.</p>
              <form onSubmit={handleSendMessage} className="message-form">
                <textarea
                  ref={messageRef}
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
          )}
        </>
      )}

      {activeTab === 'messages' && (
        <MessagesTab
          texts={texts}
          error={textsError}
          onReload={() => getTexts(id).then(setTexts).catch((e) => setTextsError(e.message))}
        />
      )}
    </div>
  )
}

function MessagesTab({ texts, error, onReload }) {
  const [expanded, setExpanded] = useState(new Set())
  const [resendingId, setResendingId] = useState(null)
  const [resendError, setResendError] = useState(null)

  function toggle(id) {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleResend(id) {
    setResendingId(id)
    setResendError(null)
    try {
      await resendText(id)
      await onReload()
    } catch (e) {
      setResendError(e.message)
    } finally {
      setResendingId(null)
    }
  }

  if (error) return <div className="error-banner">{error}</div>
  if (!texts) return <div className="page loading">Loading…</div>

  if (texts.length === 0) {
    return (
      <section className="card">
        <p className="empty">No messages yet. Launch the event to send invite messages.</p>
      </section>
    )
  }

  return (
    <section className="card">
      {resendError && <div className="error-banner">{resendError}</div>}
      <table className="table">
        <thead>
          <tr>
            <th>Created</th>
            <th>Recipient</th>
            <th>Phone</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {texts.map((t) => (
            <>
              <tr key={t.id}>
                <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>{formatDateShort(t.created_at)}</td>
                <td>{t.first_name} {t.last_name}</td>
                <td className="mono">{t.phone_number}</td>
                <td><TextStatusBadge status={t.status} /></td>
                <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                  {t.status === 'failed' && (
                    <button
                      className="btn-ghost btn-sm"
                      style={{ marginRight: 8 }}
                      onClick={() => handleResend(t.id)}
                      disabled={resendingId === t.id}
                    >
                      {resendingId === t.id ? 'Resending…' : 'Resend'}
                    </button>
                  )}
                  <button
                    className="expand-btn"
                    onClick={() => toggle(t.id)}
                    title={expanded.has(t.id) ? 'Collapse' : 'Expand'}
                  >
                    {expanded.has(t.id) ? '▲' : '▼'}
                  </button>
                </td>
              </tr>
              {expanded.has(t.id) && (
                <tr key={`${t.id}-body`} className="message-body-row">
                  <td colSpan={5}>
                    {t.status === 'failed' && t.error && (
                      <p style={{ margin: '0 0 0.5rem', color: 'var(--danger)' }}>Error: {t.error}</p>
                    )}
                    <pre className="message-body">{t.content}</pre>
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function TextStatusBadge({ status }) {
  const cls = {
    'pending': 'badge-none',
    'sent':    'badge-accepted',
    'failed':  'badge-declined',
  }[status] || 'badge-none'
  return <span className={`badge ${cls}`}>{status}</span>
}

function LaunchModal({ inviteeCount, launching, onConfirm, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Launch Event</h2>
        <p>
          This will send invite messages to{' '}
          <strong>{inviteeCount} {inviteeCount === 1 ? 'invitee' : 'invitees'}</strong>.
          The event status will change to <strong>Launched</strong> and cannot be undone.
        </p>
        {inviteeCount === 0 && (
          <p className="error-banner">Add at least one invitee before launching.</p>
        )}
        <div className="form-actions">
          <button className="btn-ghost" onClick={onClose} disabled={launching}>Cancel</button>
          <button
            className="btn-launch"
            onClick={onConfirm}
            disabled={launching || inviteeCount === 0}
          >
            {launching ? 'Launching…' : 'Send Invites'}
          </button>
        </div>
      </div>
    </div>
  )
}

function CancelModal({ event, inviteeCount, canceling, onConfirm, onClose }) {
  const [content, setContent] = useState(() => defaultCancellationMessage(event))

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h2>Cancel Event</h2>
        <p>
          This will mark <strong>{event.name}</strong> as canceled and queue the message below
          to <strong>{inviteeCount} {inviteeCount === 1 ? 'invitee' : 'invitees'}</strong> who
          haven't declined. Review and edit it before sending — this cannot be undone.
        </p>
        <div className="form">
          <label>Cancellation message
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={5}
              autoFocus
            />
          </label>
        </div>
        <div className="form-actions">
          <button className="btn-ghost" onClick={onClose} disabled={canceling}>Never mind</button>
          <button
            className="btn-danger"
            onClick={() => onConfirm(content)}
            disabled={canceling || !content.trim()}
          >
            {canceling ? 'Canceling…' : 'Cancel Event & Notify'}
          </button>
        </div>
      </div>
    </div>
  )
}

function DeleteModal({ event, deleting, onConfirm, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Delete Event</h2>
        <p>
          Delete <strong>{event.name}</strong>? It will be removed from the event list, but its
          record — including any messages already sent — is kept for reference and isn't
          permanently erased.
        </p>
        <div className="form-actions">
          <button className="btn-ghost" onClick={onClose} disabled={deleting}>Cancel</button>
          <button className="btn-danger" onClick={onConfirm} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete Event'}
          </button>
        </div>
      </div>
    </div>
  )
}

function AddInviteeModal({ eventId, alreadyInvited, onAdded, onClose }) {
  const [contacts, setContacts] = useState([])
  const [search, setSearch] = useState('')
  const [mode, setMode] = useState('pick')
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

function fallbackCopy(text, onSuccess) {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  try {
    if (document.execCommand('copy')) onSuccess()
  } finally {
    document.body.removeChild(textarea)
  }
}

function InviteLink({ url }) {
  const [copied, setCopied] = useState(false)

  function copy() {
    const onCopied = () => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url).then(onCopied).catch(() => fallbackCopy(url, onCopied))
    } else {
      fallbackCopy(url, onCopied)
    }
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
