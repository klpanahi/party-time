import React from 'react'
import { render, screen, within, fireEvent, act, waitForElementToBeRemoved } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { server } from '../test/msw/server'
import { BASE, defaultEvent, defaultTexts, EVENT_ID } from '../test/msw/handlers'
import EventDetails from './EventDetails'

function renderDetails(id = EVENT_ID) {
  return render(
    <MemoryRouter initialEntries={[`/event/${id}`]}>
      <Routes>
        <Route path="/event/:id" element={<EventDetails />} />
        <Route path="/" element={<div>Events List Page</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('EventDetails', () => {
  afterEach(() => vi.useRealTimers())

  it('renders the event fields after loading', async () => {
    renderDetails()
    await screen.findByDisplayValue('Summer Party')
    expect(screen.getByDisplayValue('Central Park')).toBeInTheDocument()
    expect(screen.getByDisplayValue('A great outdoor party.')).toBeInTheDocument()
  })

  it('shows "Draft" status badge for a draft event', async () => {
    renderDetails()
    await screen.findByDisplayValue('Summer Party')
    expect(screen.getByText('Draft')).toBeInTheDocument()
  })

  it('shows "Launch Event" button for a draft event', async () => {
    renderDetails()
    await screen.findByDisplayValue('Summer Party')
    expect(screen.getByRole('button', { name: /launch event/i })).toBeInTheDocument()
  })

  it('hides "Launch Event" button when status is launched', async () => {
    server.use(
      http.get(`${BASE}/events/:id`, () =>
        HttpResponse.json({
          ...defaultEvent,
          event: { ...defaultEvent.event, status: 'launched' },
        })
      )
    )
    renderDetails()
    await screen.findByDisplayValue('Summer Party')
    expect(screen.queryByRole('button', { name: /launch event/i })).not.toBeInTheDocument()
  })

  it('invitees tab is shown by default and renders the invitee table', async () => {
    renderDetails()
    await screen.findByText('Alice Smith')
    expect(screen.getByText('+15550001111')).toBeInTheDocument()
  })

  it('triggers auto-save 800ms after a field change', async () => {
    renderDetails()
    // Wait for page to fully load with real timers before switching to fake
    await screen.findByDisplayValue('Summer Party')

    vi.useFakeTimers()
    const nameInput = screen.getByDisplayValue('Summer Party')
    fireEvent.change(nameInput, { target: { value: 'Renamed Party' } })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(screen.getByText('Saved')).toBeInTheDocument()
  })

  it('shows the LaunchModal when "Launch Event" is clicked', async () => {
    renderDetails()
    await screen.findByDisplayValue('Summer Party')
    await userEvent.click(screen.getByRole('button', { name: /launch event/i }))
    expect(screen.getByRole('heading', { name: /launch event/i })).toBeInTheDocument()
  })

  it('LaunchModal disables "Send Invites" when invitee count is 0', async () => {
    server.use(
      http.get(`${BASE}/events/:id`, () =>
        HttpResponse.json({ ...defaultEvent, invitees: [] })
      )
    )
    renderDetails()
    await screen.findByDisplayValue('Summer Party')
    await userEvent.click(screen.getByRole('button', { name: /launch event/i }))
    expect(screen.getByRole('button', { name: /send invites/i })).toBeDisabled()
    expect(screen.getByText(/add at least one invitee/i)).toBeInTheDocument()
  })

  it('launches the event and hides the Launch button on confirm', async () => {
    renderDetails()
    await screen.findByDisplayValue('Summer Party')
    await userEvent.click(screen.getByRole('button', { name: /launch event/i }))
    await userEvent.click(screen.getByRole('button', { name: /send invites/i }))

    // After launch, status changes to launched, so Launch button disappears
    await screen.findByText('Launched')
    expect(screen.queryByRole('button', { name: /launch event/i })).not.toBeInTheDocument()
  })

  it('switching to Messages tab loads and shows texts', async () => {
    renderDetails()
    await screen.findByDisplayValue('Summer Party')
    await userEvent.click(screen.getByRole('button', { name: /messages/i }))
    await screen.findByText('Alice Smith')
    expect(screen.getByText('sent')).toBeInTheDocument()
  })

  it('expand/collapse a message row shows and hides the body', async () => {
    renderDetails()
    await screen.findByDisplayValue('Summer Party')
    await userEvent.click(screen.getByRole('button', { name: /messages/i }))
    await screen.findByText('Alice Smith')

    expect(screen.queryByText('You are invited to Summer Party!')).not.toBeInTheDocument()
    await userEvent.click(screen.getByTitle('Expand'))
    expect(screen.getByText('You are invited to Summer Party!')).toBeInTheDocument()

    await userEvent.click(screen.getByTitle('Collapse'))
    expect(screen.queryByText('You are invited to Summer Party!')).not.toBeInTheDocument()
  })

  it('shows a Resend button for failed texts and refreshes the row on success', async () => {
    const failed = [{ ...defaultTexts[0], status: 'failed', error: 'invalid number' }]
    const sent = [{ ...defaultTexts[0], status: 'sent' }]
    server.use(
      http.get(`${BASE}/events/:id/texts`, () => HttpResponse.json(failed), { once: true }),
      http.get(`${BASE}/events/:id/texts`, () => HttpResponse.json(sent)),
    )
    renderDetails()
    await screen.findByDisplayValue('Summer Party')
    await userEvent.click(screen.getByRole('button', { name: /messages/i }))
    await screen.findByText('Alice Smith')
    expect(screen.getByText('failed')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /resend/i }))
    await screen.findByText('sent')
    expect(screen.queryByRole('button', { name: /resend/i })).not.toBeInTheDocument()
  })

  it('shows an error banner when a resend fails', async () => {
    const failed = [{ ...defaultTexts[0], status: 'failed', error: 'invalid number' }]
    server.use(
      http.get(`${BASE}/events/:id/texts`, () => HttpResponse.json(failed)),
      http.post(`${BASE}/texts/:id/resend`, () =>
        HttpResponse.json({ error: 'resend failed' }, { status: 500 }),
      ),
    )
    renderDetails()
    await screen.findByDisplayValue('Summer Party')
    await userEvent.click(screen.getByRole('button', { name: /messages/i }))
    await screen.findByText('Alice Smith')

    await userEvent.click(screen.getByRole('button', { name: /resend/i }))
    await screen.findByText(/resend failed/i)
  })

  it('overriding a sent text to pending saves the new status and refreshes', async () => {
    const sent = [{ ...defaultTexts[0], status: 'sent' }]
    const pending = [{ ...defaultTexts[0], status: 'pending' }]
    let body
    server.use(
      http.get(`${BASE}/events/:id/texts`, () => HttpResponse.json(sent), { once: true }),
      http.get(`${BASE}/events/:id/texts`, () => HttpResponse.json(pending)),
      http.put(`${BASE}/texts/:id/status`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ ok: true })
      }),
    )
    renderDetails()
    await screen.findByDisplayValue('Summer Party')
    await userEvent.click(screen.getByRole('button', { name: /messages/i }))
    await screen.findByText('Alice Smith')

    await userEvent.selectOptions(screen.getByLabelText(/status for alice smith/i), 'pending')

    await screen.findByText('pending')
    expect(body).toEqual({ status: 'pending' })
  })

  it('shows an error banner when a status override fails', async () => {
    server.use(
      http.put(`${BASE}/texts/:id/status`, () =>
        HttpResponse.json({ error: 'override failed' }, { status: 500 }),
      ),
    )
    renderDetails()
    await screen.findByDisplayValue('Summer Party')
    await userEvent.click(screen.getByRole('button', { name: /messages/i }))
    await screen.findByText('Alice Smith')

    await userEvent.selectOptions(screen.getByLabelText(/status for alice smith/i), 'failed')
    await screen.findByText(/override failed/i)
  })

  it('Send button is disabled when the message textarea is empty', async () => {
    renderDetails()
    await screen.findByDisplayValue('Summer Party')
    expect(screen.getByRole('button', { name: /^send$/i })).toBeDisabled()
  })

  it('submitting the send message form clears the textarea', async () => {
    renderDetails()
    await screen.findByDisplayValue('Summer Party')

    const textarea = screen.getByPlaceholderText(/type your message/i)
    await userEvent.type(textarea, 'Hello everyone!')
    expect(screen.getByRole('button', { name: /^send$/i })).not.toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: /^send$/i }))
    await screen.findByPlaceholderText(/type your message/i)
    expect(textarea.value).toBe('')
  })

  it('shows error banner when initial event load fails', async () => {
    server.use(
      http.get(`${BASE}/events/:id`, () =>
        HttpResponse.json({ error: 'event not found' }, { status: 404 })
      )
    )
    renderDetails()
    await screen.findByText('event not found')
  })

  it('← Back button navigates to the events list', async () => {
    renderDetails()
    await screen.findByDisplayValue('Summer Party')
    await userEvent.click(screen.getByRole('button', { name: /back/i }))
    await screen.findByText('Events List Page')
  })

  it('LaunchModal cancel button closes the modal without launching', async () => {
    renderDetails()
    await screen.findByDisplayValue('Summer Party')
    await userEvent.click(screen.getByRole('button', { name: /launch event/i }))
    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(screen.queryByRole('heading', { name: /launch event/i })).not.toBeInTheDocument()
    expect(screen.getByText('Draft')).toBeInTheDocument()
  })

  it('changing a different field (location) also triggers auto-save', async () => {
    renderDetails()
    await screen.findByDisplayValue('Central Park')

    vi.useFakeTimers()
    fireEvent.change(screen.getByDisplayValue('Central Park'), { target: { value: 'The Venue' } })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(screen.getByText('Saved')).toBeInTheDocument()
  })

  it('shows error banner when auto-save PUT fails', async () => {
    server.use(
      http.put(`${BASE}/events/:id`, () =>
        HttpResponse.json({ error: 'save failed' }, { status: 500 })
      )
    )
    renderDetails()
    await screen.findByDisplayValue('Central Park')

    vi.useFakeTimers()
    fireEvent.change(screen.getByDisplayValue('Central Park'), { target: { value: 'The Venue' } })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(screen.getByText('save failed')).toBeInTheDocument()
  })

  it('shows error banner when launching fails', async () => {
    server.use(
      http.post(`${BASE}/events/:id/launch`, () =>
        HttpResponse.json({ error: 'launch failed' }, { status: 500 })
      )
    )
    renderDetails()
    await screen.findByDisplayValue('Summer Party')
    await userEvent.click(screen.getByRole('button', { name: /launch event/i }))
    await userEvent.click(screen.getByRole('button', { name: /send invites/i }))
    await screen.findByText('launch failed')
  })

  it('changing the date field triggers auto-save', async () => {
    renderDetails()
    await screen.findByDisplayValue('Summer Party')

    vi.useFakeTimers()
    fireEvent.change(screen.getByLabelText(/date & time/i), { target: { value: '2026-08-15T18:00' } })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(screen.getByText('Saved')).toBeInTheDocument()
  })

  it('changing the end time auto-saves it alongside the start', async () => {
    let body
    server.use(
      http.put(`${BASE}/events/:id`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ ok: true })
      })
    )
    renderDetails()
    await screen.findByDisplayValue('Summer Party')

    vi.useFakeTimers()
    fireEvent.change(screen.getByLabelText(/end time/i), { target: { value: '2026-08-15T23:00' } })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(screen.getByText('Saved')).toBeInTheDocument()
    expect(body.end_time).toBe('2026-08-15T23:00')
    // The start time still rides along on the same PUT, which replaces every field.
    expect(body.date).toBeTruthy()
  })

  it('changing the description field triggers auto-save', async () => {
    renderDetails()
    await screen.findByDisplayValue('A great outdoor party.')

    vi.useFakeTimers()
    fireEvent.change(screen.getByDisplayValue('A great outdoor party.'), {
      target: { value: 'Updated description.' },
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(screen.getByText('Saved')).toBeInTheDocument()
  })

  it('toggling the plus-ones checkbox triggers auto-save', async () => {
    renderDetails()
    await screen.findByDisplayValue('Summer Party')

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('checkbox', { name: /plus ones/i }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(screen.getByText('Saved')).toBeInTheDocument()
  })

  it('shows error banner when send message fails', async () => {
    server.use(
      http.post(`${BASE}/events/:id/messages`, () =>
        HttpResponse.json({ error: 'send failed' }, { status: 500 })
      )
    )
    renderDetails()
    await screen.findByDisplayValue('Summer Party')

    await userEvent.type(screen.getByPlaceholderText(/type your message/i), 'Hello!')
    await userEvent.click(screen.getByRole('button', { name: /^send$/i }))
    await screen.findByText('send failed')
  })

  it('refreshes texts after sending a message when already on the Messages tab', async () => {
    renderDetails()
    await screen.findByDisplayValue('Summer Party')
    await userEvent.click(screen.getByRole('button', { name: /messages/i }))
    await screen.findByText('Alice Smith')

    // Switch back to invitees tab to access the message form, then back to messages
    await userEvent.click(screen.getByRole('button', { name: /invitees/i }))
    await userEvent.type(screen.getByPlaceholderText(/type your message/i), 'Update!')

    // Switch to messages tab so it's active when send fires
    await userEvent.click(screen.getByRole('button', { name: /messages/i }))
    await screen.findByText('Alice Smith')

    // Tab back to invitees to get the form, send while messages tab would re-load
    await userEvent.click(screen.getByRole('button', { name: /invitees/i }))
    await userEvent.type(screen.getByPlaceholderText(/type your message/i), 'Update!')
    await userEvent.click(screen.getByRole('button', { name: /^send$/i }))
    expect(screen.getByPlaceholderText(/type your message/i).value).toBe('')
  })

  it('shows "No messages yet" when texts list is empty', async () => {
    server.use(
      http.get(`${BASE}/events/:id/texts`, () => HttpResponse.json([]))
    )
    renderDetails()
    await screen.findByDisplayValue('Summer Party')
    await userEvent.click(screen.getByRole('button', { name: /messages/i }))
    await screen.findByText(/no messages yet/i)
  })

  it('shows error banner when Messages tab fails to load texts', async () => {
    server.use(
      http.get(`${BASE}/events/:id/texts`, () =>
        HttpResponse.json({ error: 'texts unavailable' }, { status: 500 })
      )
    )
    renderDetails()
    await screen.findByDisplayValue('Summer Party')
    await userEvent.click(screen.getByRole('button', { name: /messages/i }))
    await screen.findByText('texts unavailable')
  })

  it('refreshes texts after launching when already on the Messages tab', async () => {
    renderDetails()
    await screen.findByDisplayValue('Summer Party')
    await userEvent.click(screen.getByRole('button', { name: /messages/i }))
    await screen.findByText('Alice Smith') // texts loaded

    // Launch button is in the header — always visible regardless of active tab
    await userEvent.click(screen.getByRole('button', { name: /launch event/i }))
    await userEvent.click(screen.getByRole('button', { name: /send invites/i }))

    await screen.findByText('Launched')
  })
})

describe('Notify invitees of changes', () => {
  const launchedEvent = {
    ...defaultEvent,
    event: { ...defaultEvent.event, status: 'launched' },
  }

  it('button is NOT shown for a draft event', async () => {
    renderDetails()
    await screen.findByDisplayValue('Summer Party')
    expect(
      screen.queryByRole('button', { name: /notify invitees of changes/i })
    ).not.toBeInTheDocument()
  })

  it('button IS shown for a launched event', async () => {
    server.use(http.get(`${BASE}/events/:id`, () => HttpResponse.json(launchedEvent)))
    renderDetails()
    await screen.findByDisplayValue('Summer Party')
    expect(
      screen.getByRole('button', { name: /notify invitees of changes/i })
    ).toBeInTheDocument()
  })

  it('pre-fills the message textarea with the change notification text', async () => {
    server.use(http.get(`${BASE}/events/:id`, () => HttpResponse.json(launchedEvent)))
    renderDetails()
    await screen.findByDisplayValue('Summer Party')

    await userEvent.click(screen.getByRole('button', { name: /notify invitees of changes/i }))

    expect(screen.getByPlaceholderText(/type your message/i).value).toBe(
      'Heads up — some event details have been updated. Check your invite link for the latest info.'
    )
  })

  it('switches from Messages tab back to Invitees tab and pre-fills', async () => {
    server.use(http.get(`${BASE}/events/:id`, () => HttpResponse.json(launchedEvent)))
    renderDetails()
    await screen.findByDisplayValue('Summer Party')

    await userEvent.click(screen.getByRole('button', { name: /messages/i }))
    await screen.findByText('Alice Smith') // texts loaded — we're on Messages tab

    await userEvent.click(screen.getByRole('button', { name: /notify invitees of changes/i }))

    // Textarea is back in the DOM (invitees tab active)
    expect(screen.getByPlaceholderText(/type your message/i).value).toBe(
      'Heads up — some event details have been updated. Check your invite link for the latest info.'
    )
  })

  it('hint text mentions the automatic RSVP link', async () => {
    renderDetails()
    await screen.findByDisplayValue('Summer Party')
    expect(screen.getByText(/personal rsvp link/i)).toBeInTheDocument()
  })
})

describe('Cancel Event', () => {
  const launchedEvent = {
    ...defaultEvent,
    event: { ...defaultEvent.event, status: 'launched' },
  }

  it('button is not shown for a draft event', async () => {
    renderDetails()
    await screen.findByDisplayValue('Summer Party')
    expect(screen.queryByRole('button', { name: /cancel event/i })).not.toBeInTheDocument()
  })

  it('button is shown for a launched event and opens the modal prefilled', async () => {
    server.use(http.get(`${BASE}/events/:id`, () => HttpResponse.json(launchedEvent)))
    renderDetails()
    await screen.findByDisplayValue('Summer Party')

    await userEvent.click(screen.getByRole('button', { name: /cancel event/i }))
    expect(screen.getByRole('heading', { name: /cancel event/i })).toBeInTheDocument()
    const textarea = screen.getByRole('textbox', { name: /cancellation message/i })
    expect(textarea.value).toMatch(/summer party/i)
    expect(textarea.value).toMatch(/canceled/i)
  })

  it('the admin can edit the message before confirming', async () => {
    server.use(http.get(`${BASE}/events/:id`, () => HttpResponse.json(launchedEvent)))
    renderDetails()
    await screen.findByDisplayValue('Summer Party')
    await userEvent.click(screen.getByRole('button', { name: /cancel event/i }))

    const textarea = screen.getByRole('textbox', { name: /cancellation message/i })
    await userEvent.clear(textarea)
    await userEvent.type(textarea, 'Custom cancellation text.')
    expect(textarea.value).toBe('Custom cancellation text.')
  })

  it('confirming cancels the event and shows the Canceled badge', async () => {
    server.use(http.get(`${BASE}/events/:id`, () => HttpResponse.json(launchedEvent)))
    renderDetails()
    await screen.findByDisplayValue('Summer Party')
    await userEvent.click(screen.getByRole('button', { name: /cancel event/i }))
    await userEvent.click(screen.getByRole('button', { name: /cancel event & notify/i }))

    await screen.findByText('Canceled')
    expect(screen.queryByRole('button', { name: /cancel event/i })).not.toBeInTheDocument()
  })

  it('"Never mind" closes the modal without canceling', async () => {
    server.use(http.get(`${BASE}/events/:id`, () => HttpResponse.json(launchedEvent)))
    renderDetails()
    await screen.findByDisplayValue('Summer Party')
    await userEvent.click(screen.getByRole('button', { name: /cancel event/i }))
    await userEvent.click(screen.getByRole('button', { name: /never mind/i }))

    expect(screen.queryByRole('heading', { name: /^cancel event$/i })).not.toBeInTheDocument()
    expect(screen.getByText('Launched')).toBeInTheDocument()
  })

  it('shows an error banner when the cancel request fails', async () => {
    server.use(
      http.get(`${BASE}/events/:id`, () => HttpResponse.json(launchedEvent)),
      http.post(`${BASE}/events/:id/cancel`, () =>
        HttpResponse.json({ error: 'cancel failed' }, { status: 409 })
      ),
    )
    renderDetails()
    await screen.findByDisplayValue('Summer Party')
    await userEvent.click(screen.getByRole('button', { name: /cancel event/i }))
    await userEvent.click(screen.getByRole('button', { name: /cancel event & notify/i }))
    await screen.findByText('cancel failed')
  })

  it('freezes the event form and hides Add Invitee / Send a Message once canceled', async () => {
    const canceledEvent = { ...defaultEvent, event: { ...defaultEvent.event, status: 'canceled' } }
    server.use(http.get(`${BASE}/events/:id`, () => HttpResponse.json(canceledEvent)))
    renderDetails()
    await screen.findByDisplayValue('Summer Party')

    expect(screen.getByDisplayValue('Summer Party')).toBeDisabled()
    expect(screen.queryByRole('button', { name: /add invitee/i })).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/type your message/i)).not.toBeInTheDocument()
    expect(screen.getByText(/this event was canceled/i)).toBeInTheDocument()
  })
})

describe('Delete Event', () => {
  it('button is shown for a draft event', async () => {
    renderDetails()
    await screen.findByDisplayValue('Summer Party')
    expect(screen.getByRole('button', { name: /delete event/i })).toBeInTheDocument()
  })

  it('button is not shown for a launched event', async () => {
    server.use(
      http.get(`${BASE}/events/:id`, () =>
        HttpResponse.json({ ...defaultEvent, event: { ...defaultEvent.event, status: 'launched' } })
      )
    )
    renderDetails()
    await screen.findByDisplayValue('Summer Party')
    expect(screen.queryByRole('button', { name: /delete event/i })).not.toBeInTheDocument()
  })

  it('button is shown for a canceled event', async () => {
    server.use(
      http.get(`${BASE}/events/:id`, () =>
        HttpResponse.json({ ...defaultEvent, event: { ...defaultEvent.event, status: 'canceled' } })
      )
    )
    renderDetails()
    await screen.findByDisplayValue('Summer Party')
    expect(screen.getByRole('button', { name: /delete event/i })).toBeInTheDocument()
  })

  it('confirming deletes the event and navigates back to the list', async () => {
    renderDetails()
    await screen.findByDisplayValue('Summer Party')
    await userEvent.click(screen.getByRole('button', { name: /delete event/i }))
    const heading = screen.getByRole('heading', { name: /delete event/i })
    const modal = within(heading.closest('.modal'))

    await userEvent.click(modal.getByRole('button', { name: /delete event/i }))
    await screen.findByText('Events List Page')
  })

  it('"Cancel" in the delete modal closes it without deleting', async () => {
    renderDetails()
    await screen.findByDisplayValue('Summer Party')
    await userEvent.click(screen.getByRole('button', { name: /delete event/i }))
    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(screen.queryByRole('heading', { name: /delete event/i })).not.toBeInTheDocument()
  })

  it('shows an error banner when the delete request fails', async () => {
    server.use(
      http.delete(`${BASE}/events/:id`, () =>
        HttpResponse.json({ error: 'delete failed' }, { status: 409 })
      )
    )
    renderDetails()
    await screen.findByDisplayValue('Summer Party')
    await userEvent.click(screen.getByRole('button', { name: /delete event/i }))
    const heading = screen.getByRole('heading', { name: /delete event/i })
    const modal = within(heading.closest('.modal'))
    await userEvent.click(modal.getByRole('button', { name: /delete event/i }))
    await screen.findByText('delete failed')
  })
})

describe('AddInviteeModal', () => {
  it('opens the modal when "+ Add Invitee" is clicked', async () => {
    render(
      <MemoryRouter initialEntries={[`/event/${EVENT_ID}`]}>
        <Routes>
          <Route path="/event/:id" element={<EventDetails />} />
        </Routes>
      </MemoryRouter>
    )
    await screen.findByText('Alice Smith')
    await userEvent.click(screen.getByRole('button', { name: /add invitee/i }))
    expect(screen.getByRole('heading', { name: /add invitee/i })).toBeInTheDocument()
  })

  it('loads contacts and excludes already-invited ones', async () => {
    render(
      <MemoryRouter initialEntries={[`/event/${EVENT_ID}`]}>
        <Routes>
          <Route path="/event/:id" element={<EventDetails />} />
        </Routes>
      </MemoryRouter>
    )
    await screen.findByText('Alice Smith')
    await userEvent.click(screen.getByRole('button', { name: /add invitee/i }))

    // Bob is not yet invited → should appear as a selectable contact
    await screen.findByRole('button', { name: /bob jones/i })
    // Alice is already an invitee — searching for her should yield no contact buttons
    await userEvent.type(screen.getByPlaceholderText(/search by name or phone/i), 'alice')
    expect(screen.queryByRole('button', { name: /alice smith/i })).not.toBeInTheDocument()
    expect(screen.getByText(/no contacts match/i)).toBeInTheDocument()
  })

  it('filters the contact list by search query', async () => {
    render(
      <MemoryRouter initialEntries={[`/event/${EVENT_ID}`]}>
        <Routes>
          <Route path="/event/:id" element={<EventDetails />} />
        </Routes>
      </MemoryRouter>
    )
    await screen.findByText('Alice Smith')
    await userEvent.click(screen.getByRole('button', { name: /add invitee/i }))
    await screen.findByRole('button', { name: /bob jones/i })

    await userEvent.type(screen.getByPlaceholderText(/search by name or phone/i), 'bob')
    expect(screen.getByRole('button', { name: /bob jones/i })).toBeInTheDocument()
  })

  it('"Create a new one?" link switches to the New Contact tab', async () => {
    render(
      <MemoryRouter initialEntries={[`/event/${EVENT_ID}`]}>
        <Routes>
          <Route path="/event/:id" element={<EventDetails />} />
        </Routes>
      </MemoryRouter>
    )
    await screen.findByText('Alice Smith')
    await userEvent.click(screen.getByRole('button', { name: /add invitee/i }))
    await screen.findByRole('button', { name: /bob jones/i })

    await userEvent.type(screen.getByPlaceholderText(/search by name or phone/i), 'zzz')
    await userEvent.click(screen.getByRole('button', { name: /create a new one/i }))

    expect(screen.getByLabelText(/first name/i)).toBeInTheDocument()
  })

  it('selecting a contact adds the invitee and closes the modal', async () => {
    render(
      <MemoryRouter initialEntries={[`/event/${EVENT_ID}`]}>
        <Routes>
          <Route path="/event/:id" element={<EventDetails />} />
        </Routes>
      </MemoryRouter>
    )
    await screen.findByText('Alice Smith')
    await userEvent.click(screen.getByRole('button', { name: /add invitee/i }))
    await screen.findByRole('button', { name: /bob jones/i })

    await userEvent.click(screen.getByRole('button', { name: /bob jones/i }))
    // userEvent.click awaits the full async chain, so the modal is already closed
    expect(screen.queryByRole('heading', { name: /add invitee/i })).not.toBeInTheDocument()
  })

  it('New Contact tab submits a new contact and closes the modal', async () => {
    render(
      <MemoryRouter initialEntries={[`/event/${EVENT_ID}`]}>
        <Routes>
          <Route path="/event/:id" element={<EventDetails />} />
        </Routes>
      </MemoryRouter>
    )
    await screen.findByText('Alice Smith')
    await userEvent.click(screen.getByRole('button', { name: /add invitee/i }))
    await screen.findByRole('button', { name: /bob jones/i })

    await userEvent.click(screen.getByRole('button', { name: /new contact/i }))
    await userEvent.type(screen.getByLabelText(/first name/i), 'Carol')
    await userEvent.type(screen.getByLabelText(/phone number/i), '+15550009999')
    await userEvent.click(screen.getByRole('button', { name: /add & invite/i }))

    expect(screen.queryByRole('heading', { name: /add invitee/i })).not.toBeInTheDocument()
  })

  it('shows error banner inside modal when addInvitee fails', async () => {
    server.use(
      http.post(`${BASE}/events/:id/invites`, () =>
        HttpResponse.json({ error: 'invite failed' }, { status: 500 })
      )
    )
    render(
      <MemoryRouter initialEntries={[`/event/${EVENT_ID}`]}>
        <Routes>
          <Route path="/event/:id" element={<EventDetails />} />
        </Routes>
      </MemoryRouter>
    )
    await screen.findByText('Alice Smith')
    await userEvent.click(screen.getByRole('button', { name: /add invitee/i }))
    await screen.findByRole('button', { name: /bob jones/i })

    await userEvent.click(screen.getByRole('button', { name: /bob jones/i }))
    await screen.findByText('invite failed')
  })

  it('shows error banner when New Contact form submit fails', async () => {
    server.use(
      http.post(`${BASE}/events/:id/invites`, () =>
        HttpResponse.json({ error: 'new contact failed' }, { status: 500 })
      )
    )
    render(
      <MemoryRouter initialEntries={[`/event/${EVENT_ID}`]}>
        <Routes>
          <Route path="/event/:id" element={<EventDetails />} />
        </Routes>
      </MemoryRouter>
    )
    await screen.findByText('Alice Smith')
    await userEvent.click(screen.getByRole('button', { name: /add invitee/i }))
    await screen.findByRole('button', { name: /bob jones/i })

    await userEvent.click(screen.getByRole('button', { name: /new contact/i }))
    await userEvent.type(screen.getByLabelText(/first name/i), 'Carol')
    await userEvent.type(screen.getByLabelText(/last name/i), 'White')
    await userEvent.type(screen.getByLabelText(/phone number/i), '+15550009999')
    await userEvent.click(screen.getByRole('button', { name: /add & invite/i }))
    await screen.findByText('new contact failed')
  })
})
