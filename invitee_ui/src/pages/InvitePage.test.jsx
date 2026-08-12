import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../test/msw/server'
import { BASE, defaultInvite, INVITE_ID } from '../test/msw/handlers'
import InvitePage from './InvitePage'

function renderInvite(id = INVITE_ID) {
  return render(
    <MemoryRouter initialEntries={[`/invite/${id}`]}>
      <Routes>
        <Route path="/invite/:id" element={<InvitePage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('InvitePage', () => {
  it('shows a loading state before the invite loads', () => {
    renderInvite()
    expect(screen.getByText(/loading your invitation/i)).toBeInTheDocument()
  })

  it('renders the invite details after loading', async () => {
    renderInvite()
    await screen.findByText('Hi Alex! 👋')
    expect(screen.getByText('Birthday Bash')).toBeInTheDocument()
    expect(screen.getByText('123 Party Lane')).toBeInTheDocument()
    expect(screen.getByText('Come celebrate!')).toBeInTheDocument()
  })

  it('shows an error card when the invite is not found', async () => {
    renderInvite('nonexistent-id')
    await screen.findByText(/invite not found/i)
  })

  it('shows all three RSVP buttons for a future event', async () => {
    renderInvite()
    await screen.findByText('Hi Alex! 👋')
    expect(screen.getByRole('button', { name: /attending/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /maybe/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /can't make it/i })).toBeInTheDocument()
  })

  it('shows the guest counter when plus_ones_allowed is true', async () => {
    renderInvite()
    await screen.findByText('Hi Alex! 👋')
    expect(screen.getByText('Additional guests')).toBeInTheDocument()
  })

  it('hides the guest counter when plus_ones_allowed is false', async () => {
    server.use(
      http.get(`${BASE}/invite/:id`, () =>
        HttpResponse.json({ ...defaultInvite, plus_ones_allowed: false })
      )
    )
    renderInvite()
    await screen.findByText('Hi Alex! 👋')
    expect(screen.queryByText('Additional guests')).not.toBeInTheDocument()
  })

  it('hides the guest counter when the invitee declines', async () => {
    renderInvite()
    await screen.findByText('Hi Alex! 👋')
    await userEvent.click(screen.getByRole('button', { name: /can't make it/i }))
    expect(screen.queryByText('Additional guests')).not.toBeInTheDocument()
  })

  it('shows "Response Sent!" after clicking an RSVP option', async () => {
    renderInvite()
    await screen.findByText('Hi Alex! 👋')
    await userEvent.click(screen.getByRole('button', { name: /attending/i }))
    await screen.findByText(/response sent/i)
  })

  it('disables RSVP and guest buttons while a save is in flight', async () => {
    server.use(
      http.put(`${BASE}/invite/:id`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
        return HttpResponse.json({})
      })
    )
    renderInvite()
    await screen.findByText('Hi Alex! 👋')
    await userEvent.click(screen.getByRole('button', { name: /attending/i }))
    expect(screen.getByText(/saving/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /attending/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: '+' })).toBeDisabled()
    await screen.findByText(/response sent/i)
    expect(screen.getByRole('button', { name: /attending/i })).not.toBeDisabled()
  })

  it('shows the error card when the PUT call fails', async () => {
    server.use(
      http.put(`${BASE}/invite/:id`, () =>
        HttpResponse.json({ error: 'server error' }, { status: 500 })
      )
    )
    renderInvite()
    await screen.findByText('Hi Alex! 👋')
    await userEvent.click(screen.getByRole('button', { name: /attending/i }))
    // A PUT failure sets top-level error state, replacing the invite UI with the error card
    await screen.findByText('Failed to save')
  })

  it('increments the guest count', async () => {
    renderInvite()
    await screen.findByText('Hi Alex! 👋')
    await userEvent.click(screen.getByRole('button', { name: '+' }))
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('does not decrement the guest count below zero', async () => {
    renderInvite()
    await screen.findByText('Hi Alex! 👋')
    expect(screen.getByRole('button', { name: '−' })).toBeDisabled()
  })

  it('shows the read-only notice for a past event', async () => {
    server.use(
      http.get(`${BASE}/invite/:id`, () =>
        HttpResponse.json({
          ...defaultInvite,
          event_date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        })
      )
    )
    renderInvite()
    await screen.findByText(/this event has already taken place/i)
    expect(screen.queryByText(/will you be there/i)).not.toBeInTheDocument()
  })

  it('shows the canceled notice and hides RSVP controls for a canceled event', async () => {
    server.use(
      http.get(`${BASE}/invite/:id`, () =>
        HttpResponse.json({ ...defaultInvite, event_status: 'canceled' })
      )
    )
    renderInvite()
    await screen.findByText(/this event has been canceled/i)
    expect(screen.queryByText(/will you be there/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /attending/i })).not.toBeInTheDocument()
  })

  it('takes priority over the past-event notice when both apply', async () => {
    server.use(
      http.get(`${BASE}/invite/:id`, () =>
        HttpResponse.json({
          ...defaultInvite,
          event_status: 'canceled',
          event_date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        })
      )
    )
    renderInvite()
    await screen.findByText(/this event has been canceled/i)
    expect(screen.queryByText(/already taken place/i)).not.toBeInTheDocument()
  })

  it('renders the co-invitees list when present', async () => {
    server.use(
      http.get(`${BASE}/invite/:id`, () =>
        HttpResponse.json({
          ...defaultInvite,
          co_invitees: [
            { first_name: 'Jordan', last_initial: 'K', rsvp_status: 'Accepted', additional_guests: 1 },
            { first_name: 'Sam', last_initial: '', rsvp_status: 'No Response', additional_guests: 0 },
          ],
        })
      )
    )
    renderInvite()
    await screen.findByText('Who else is invited')
    expect(screen.getByText('Jordan K.')).toBeInTheDocument()
    expect(screen.getByText('Sam')).toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
  })

  it('does not render the co-invitees section when list is empty', async () => {
    renderInvite()
    await screen.findByText('Hi Alex! 👋')
    expect(screen.queryByText('Who else is invited')).not.toBeInTheDocument()
  })

  describe('add to calendar', () => {
    it('offers both calendar targets for an upcoming event', async () => {
      renderInvite()
      await screen.findByText('Add to calendar')
      expect(screen.getByRole('button', { name: /apple \/ outlook/i })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /google calendar/i })).toBeInTheDocument()
    })

    it('points the Google link at a prefilled template with the event window', async () => {
      renderInvite()
      await screen.findByText('Add to calendar')
      const url = new URL(screen.getByRole('link', { name: /google calendar/i }).href)
      expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render')
      expect(url.searchParams.get('text')).toBe('Birthday Bash')
      expect(url.searchParams.get('location')).toBe('123 Party Lane')
      expect(url.searchParams.get('dates')).toMatch(/^\d{8}T\d{6}Z\/\d{8}T\d{6}Z$/)
    })

    it('opens the Google link safely in a new tab', async () => {
      renderInvite()
      await screen.findByText('Add to calendar')
      const link = screen.getByRole('link', { name: /google calendar/i })
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('downloads a .ics file named after the event', async () => {
      // jsdom implements neither of these.
      const createObjectURL = vi.fn(() => 'blob:calendar')
      const revokeObjectURL = vi.fn()
      vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }))
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
        expect(this.download).toBe('birthday-bash.ics')
        expect(this.href).toBe('blob:calendar')
      })

      renderInvite()
      await screen.findByText('Add to calendar')
      await userEvent.click(screen.getByRole('button', { name: /apple \/ outlook/i }))

      expect(click).toHaveBeenCalledTimes(1)
      expect(createObjectURL).toHaveBeenCalledTimes(1)
      // The object URL is released rather than leaked.
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:calendar')
      // No stray anchor is left behind in the document.
      expect(document.querySelectorAll('a[download]')).toHaveLength(0)

      click.mockRestore()
      vi.unstubAllGlobals()
    })

    it('is hidden for a past event', async () => {
      server.use(
        http.get(`${BASE}/invite/:id`, () =>
          HttpResponse.json({
            ...defaultInvite,
            event_date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          })
        )
      )
      renderInvite()
      await screen.findByText(/already taken place/i)
      expect(screen.queryByText('Add to calendar')).not.toBeInTheDocument()
    })

    it('is hidden for a canceled event', async () => {
      server.use(
        http.get(`${BASE}/invite/:id`, () =>
          HttpResponse.json({ ...defaultInvite, event_status: 'canceled' })
        )
      )
      renderInvite()
      await screen.findByText(/this event has been canceled/i)
      expect(screen.queryByText('Add to calendar')).not.toBeInTheDocument()
    })

    it('is hidden when the event has no usable end time', async () => {
      server.use(
        http.get(`${BASE}/invite/:id`, () =>
          HttpResponse.json({ ...defaultInvite, event_end_time: null })
        )
      )
      renderInvite()
      await screen.findByText('Hi Alex! 👋')
      expect(screen.queryByText('Add to calendar')).not.toBeInTheDocument()
    })
  })
})
