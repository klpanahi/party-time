const BASE = '/admin'

async function request(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || res.statusText)
  }
  return res.json()
}

export const getContacts = () => request('GET', '/contacts')
export const createContact = (data) => request('POST', '/contacts', data)
export const updateContact = (id, data) => request('PUT', `/contacts/${id}`, data)
export const getEvents = () => request('GET', '/events')
export const getEvent = (id) => request('GET', `/events/${id}`)
export const createEvent = (data) => request('POST', '/events', data)
export const updateEvent = (id, data) => request('PUT', `/events/${id}`, data)
export const cancelEvent = (id, content) => request('POST', `/events/${id}/cancel`, { content })
export const deleteEvent = (id) => request('DELETE', `/events/${id}`)
export const addInvitee = (eventId, data) => request('POST', `/events/${eventId}/invites`, data)
export const sendMessage = (eventId, content) => request('POST', `/events/${eventId}/messages`, { content })
export const launchEvent = (eventId) => request('POST', `/events/${eventId}/launch`)
export const getTexts = (eventId) => request('GET', `/events/${eventId}/texts`)
export const resendText = (textId) => request('POST', `/texts/${textId}/resend`)
export const setTextStatus = (textId, status) => request('PUT', `/texts/${textId}/status`, { status })
