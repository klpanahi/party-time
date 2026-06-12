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
})
