import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getEvents, createEvent } from '../api'
import { formatDateShort, toDatetimeLocal } from '../dateUtils'

function isUpcoming(event) {
  return new Date(event.date) >= new Date()
}

export default function EventSummary() {
  const navigate = useNavigate()
  const [events, setEvents] = useState([])
  const [error, setError] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({
    name: '', date: '', end_time: '', description: '', location: '', plus_ones_allowed: false,
  })
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    getEvents().then(setEvents).catch((e) => setError(e.message))
  }, [])

  const upcoming = events.filter(isUpcoming)
  const past = events.filter((e) => !isUpcoming(e))

  async function handleCreate(ev) {
    ev.preventDefault()
    setCreating(true)
    try {
      const { id } = await createEvent(form)
      navigate(`/event/${id}`)
    } catch (e) {
      setError(e.message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Events</h1>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          + Create Event
        </button>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {showCreate && (
        <div className="modal-backdrop" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>New Event</h2>
            <form onSubmit={handleCreate} className="form">
              <label>Name
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label>Date &amp; Time
                <input required type="datetime-local" value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </label>
              <label>End Time
                <input required type="datetime-local" value={form.end_time}
                  onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
              </label>
              <label>Description
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </label>
              <label>Location
                <input required value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
              </label>
              <label className="checkbox-label">
                <input type="checkbox" checked={form.plus_ones_allowed}
                  onChange={(e) => setForm({ ...form, plus_ones_allowed: e.target.checked })} />
                Allow plus ones
              </label>
              <div className="form-actions">
                <button type="button" className="btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={creating}>
                  {creating ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <section>
        <h2 className="section-title">Upcoming</h2>
        {upcoming.length === 0
          ? <p className="empty">No upcoming events.</p>
          : <EventTable events={upcoming} onRowClick={(id) => navigate(`/event/${id}`)} />}
      </section>

      <section>
        <h2 className="section-title">Past</h2>
        {past.length === 0
          ? <p className="empty">No past events.</p>
          : <EventTable events={past} onRowClick={(id) => navigate(`/event/${id}`)} />}
      </section>
    </div>
  )
}

function EventTable({ events, onRowClick }) {
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Event</th>
          <th>Status</th>
          <th>Date</th>
          <th>Total</th>
          <th>Accepted</th>
          <th>Tentative</th>
          <th>Declined</th>
          <th>No Response</th>
        </tr>
      </thead>
      <tbody>
        {events.map((e) => (
          <tr key={e.id} className="clickable-row" onClick={() => onRowClick(e.id)}>
            <td className="event-name">{e.name}</td>
            <td>
              {e.status === 'canceled'
                ? <span className="status-badge status-canceled">Canceled</span>
                : <span className="text-muted">{e.status === 'launched' ? 'Launched' : 'Draft'}</span>}
            </td>
            <td>{formatDateShort(e.date)}</td>
            <td>{e.total_invites}</td>
            <td><span className="badge badge-accepted">{e.accepted}</span></td>
            <td><span className="badge badge-tentative">{e.tentative}</span></td>
            <td><span className="badge badge-declined">{e.declined}</span></td>
            <td><span className="badge badge-none">{e.no_response}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
