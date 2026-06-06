import { useEffect, useState } from 'react'
import { getContacts, createContact, updateContact } from '../api'

export default function Contacts() {
  const [contacts, setContacts] = useState([])
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null)   // Contact object being edited
  const [showAdd, setShowAdd] = useState(false)

  useEffect(() => {
    reload()
  }, [])

  function reload() {
    getContacts().then(setContacts).catch((e) => setError(e.message))
  }

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
          onSave={async (form) => {
            await updateContact(editing.id, form)
            reload()
            setEditing(null)
          }}
          onClose={() => setEditing(null)}
        />
      )}

      {contacts.length === 0
        ? <p className="empty">No contacts yet.</p>
        : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>First Name</th>
                  <th>Last Name</th>
                  <th>Phone</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id}>
                    <td>{c.first_name}</td>
                    <td>{c.last_name || <span className="text-muted">—</span>}</td>
                    <td className="mono">{c.phone_number}</td>
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

function ContactModal({ title, initial = {}, onSave, onClose }) {
  const [form, setForm] = useState({
    first_name: initial.first_name || '',
    last_name: initial.last_name || '',
    phone_number: initial.phone_number || '',
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
