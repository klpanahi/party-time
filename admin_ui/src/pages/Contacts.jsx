import { useEffect, useState } from 'react'
import { getContacts, createContact, updateContact } from '../api'
import { TagChips, TagFilter, TagInput } from '../tags'
import { allTagsOf, matchesTags } from '../tagUtils'

// How each contact gets texted. The sender script reads message_type straight
// off the contact instead of trying iMessage and falling back, so this is the
// switch you flip when an iMessage never reaches someone.
const MESSAGE_TYPE_LABELS = { imessage: 'iMessage', sms: 'SMS' }

export default function Contacts() {
  const [contacts, setContacts] = useState([])
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null)   // Contact object being edited
  const [showAdd, setShowAdd] = useState(false)
  const [tagFilter, setTagFilter] = useState([])

  useEffect(() => {
    reload()
  }, [])

  function reload() {
    getContacts().then(setContacts).catch((e) => setError(e.message))
  }

  const allTags = allTagsOf(contacts)
  const shown = contacts.filter((c) => matchesTags(c, tagFilter))

  return (
    <div className="page">
      <header className="page-header">
        <h1>Contacts</h1>
        <button className="btn-primary" onClick={() => setShowAdd(true)}>+ Add Contact</button>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {showAdd && (
        <ContactModal
          title="New Contact"
          allTags={allTags}
          onSave={async (form) => {
            await createContact(form)
            reload()
            setShowAdd(false)
          }}
          onClose={() => setShowAdd(false)}
        />
      )}

      {editing && (
        <ContactModal
          title="Edit Contact"
          initial={editing}
          allTags={allTags}
          onSave={async (form) => {
            await updateContact(editing.id, form)
            reload()
            setEditing(null)
          }}
          onClose={() => setEditing(null)}
        />
      )}

      <TagFilter allTags={allTags} selected={tagFilter} onChange={setTagFilter} />

      {contacts.length === 0
        ? <p className="empty">No contacts yet.</p>
        : shown.length === 0
        ? <p className="empty">No contacts have those interests.</p>
        : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>First Name</th>
                  <th>Last Name</th>
                  <th>Phone</th>
                  <th>Message Type</th>
                  <th>Interests</th>
                  <th>Notes</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.id}>
                    <td>{c.first_name}</td>
                    <td>{c.last_name || <span className="text-muted">—</span>}</td>
                    <td className="mono">{c.phone_number}</td>
                    <td>{MESSAGE_TYPE_LABELS[c.message_type] ?? c.message_type}</td>
                    <td>{c.tags?.length ? <TagChips tags={c.tags} /> : <span className="text-muted">—</span>}</td>
                    <td className="notes-cell">{c.notes || <span className="text-muted">—</span>}</td>
                    <td className="action-cell">
                      <button className="btn-ghost btn-sm" onClick={() => setEditing(c)}>Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  )
}

function ContactModal({ title, initial = {}, allTags = [], onSave, onClose }) {
  const [form, setForm] = useState({
    first_name: initial.first_name || '',
    last_name: initial.last_name || '',
    phone_number: initial.phone_number || '',
    message_type: initial.message_type || 'imessage',
    notes: initial.notes || '',
    tags: initial.tags || [],
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(ev) {
    ev.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await onSave(form)
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={handleSubmit} className="form">
          <label>First Name
            <input required autoFocus value={form.first_name}
              onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
          </label>
          <label>Last Name
            <input value={form.last_name}
              onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
          </label>
          <label>Phone Number
            <input required value={form.phone_number}
              onChange={(e) => setForm({ ...form, phone_number: e.target.value })} />
          </label>
          <label>Message Type
            <select value={form.message_type}
              onChange={(e) => setForm({ ...form, message_type: e.target.value })}>
              {Object.entries(MESSAGE_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <div className="form-field">
            <span>Interests</span>
            <TagInput value={form.tags} suggestions={allTags}
              onChange={(tags) => setForm({ ...form, tags })} />
          </div>
          <label>Notes
            <textarea rows={3} value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
          <div className="form-actions">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
