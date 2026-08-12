import { http, HttpResponse } from 'msw'

export const BASE = 'http://localhost:3000/admin'

export const EVENT_ID = 'event-123'
export const CONTACT_ID = 'contact-abc'

export const defaultEvents = [
  {
    id: EVENT_ID,
    name: 'Summer Party',
    date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    total_invites: 5,
    accepted: 2,
    tentative: 1,
    declined: 0,
    no_response: 2,
    status: 'draft',
  },
  {
    id: 'event-past-1',
    name: 'Past Dinner',
    date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    total_invites: 3,
    accepted: 3,
    tentative: 0,
    declined: 0,
    no_response: 0,
    status: 'launched',
  },
]

export const defaultEvent = {
  event: {
    id: EVENT_ID,
    name: 'Summer Party',
    date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    end_time: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000).toISOString(),
    location: 'Central Park',
    description: 'A great outdoor party.',
    plus_ones_allowed: true,
    status: 'draft',
  },
  invitees: [
    {
      id: 'inv-1',
      contact_id: CONTACT_ID,
      first_name: 'Alice',
      last_name: 'Smith',
      phone_number: '+15550001111',
      rsvp_status: 'No Response',
      additional_guests: 0,
      opened_at: null,
      invite_url: 'http://localhost:8081/invite/inv-1',
    },
  ],
}

export const defaultContacts = [
  { id: CONTACT_ID, first_name: 'Alice', last_name: 'Smith', phone_number: '+15550001111' },
  { id: 'contact-def', first_name: 'Bob', last_name: 'Jones', phone_number: '+15550002222' },
]

export const defaultTexts = [
  {
    id: 'text-1',
    created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    first_name: 'Alice',
    last_name: 'Smith',
    phone_number: '+15550001111',
    status: 'sent',
    content: 'You are invited to Summer Party!',
  },
]

export const handlers = [
  http.get(`${BASE}/events`, () => HttpResponse.json(defaultEvents)),

  http.get(`${BASE}/events/:id`, ({ params }) => {
    if (params.id === EVENT_ID) return HttpResponse.json(defaultEvent)
    return HttpResponse.json({ error: 'Event not found' }, { status: 404 })
  }),

  http.post(`${BASE}/events`, () => HttpResponse.json({ id: 'new-event-id' })),

  http.put(`${BASE}/events/:id`, () => HttpResponse.json({ ok: true })),

  http.post(`${BASE}/events/:id/launch`, () => HttpResponse.json({ ok: true })),

  http.post(`${BASE}/events/:id/cancel`, () =>
    HttpResponse.json({ ok: true, message_id: 'msg-1', texts_queued: 1 })),

  http.delete(`${BASE}/events/:id`, () => HttpResponse.json({ ok: true })),

  http.get(`${BASE}/events/:id/texts`, () => HttpResponse.json(defaultTexts)),

  http.post(`${BASE}/texts/:id/resend`, () => HttpResponse.json({ ok: true })),

  http.put(`${BASE}/texts/:id/status`, () => HttpResponse.json({ ok: true })),

  http.post(`${BASE}/events/:id/messages`, () => HttpResponse.json({ ok: true })),

  http.post(`${BASE}/events/:id/invites`, () => HttpResponse.json({ ok: true })),

  http.get(`${BASE}/contacts`, () => HttpResponse.json(defaultContacts)),

  http.post(`${BASE}/contacts`, () => HttpResponse.json({ id: 'new-contact-id' })),

  http.put(`${BASE}/contacts/:id`, () => HttpResponse.json({ ok: true })),
]
