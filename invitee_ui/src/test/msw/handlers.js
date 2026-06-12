import { http, HttpResponse } from 'msw'

export const INVITE_ID = 'test-invite-abc'
export const BASE = 'http://localhost:8080'

export const defaultInvite = {
  id: INVITE_ID,
  first_name: 'Alex',
  event_name: 'Birthday Bash',
  event_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 1 week from now
  event_location: '123 Party Lane',
  event_description: 'Come celebrate!',
  plus_ones_allowed: true,
  rsvp_status: 'No Response',
  additional_guests: 0,
  co_invitees: [],
}

export const handlers = [
  http.get(`${BASE}/invite/:id`, ({ params }) => {
    if (params.id === INVITE_ID) {
      return HttpResponse.json(defaultInvite)
    }
    return HttpResponse.json({ error: 'Invite not found' }, { status: 404 })
  }),

  http.put(`${BASE}/invite/:id`, () => {
    return HttpResponse.json({ ok: true })
  }),
]
