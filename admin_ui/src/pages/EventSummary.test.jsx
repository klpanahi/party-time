import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../test/msw/server'
import { BASE, defaultEvents, EVENT_ID } from '../test/msw/handlers'
import EventSummary from './EventSummary'

function renderSummary() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<EventSummary />} />
        <Route path="/event/:id" element={<div>Event Details Page</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('EventSummary', () => {
  it('renders the events list after loading', async () => {
    renderSummary()
    await screen.findByText('Summer Party')
    expect(screen.getByText('Past Dinner')).toBeInTheDocument()
  })

  it('places the future event in Upcoming and the past event in Past', async () => {
    renderSummary()
    await screen.findByText('Summer Party')
    const upcoming = screen.getByRole('heading', { name: /upcoming/i }).closest('section')
    const past = screen.getByRole('heading', { name: /past/i }).closest('section')
    expect(upcoming).toContainElement(screen.getByText('Summer Party'))
    expect(past).toContainElement(screen.getByText('Past Dinner'))
  })

  it('shows "No upcoming events." when there are none', async () => {
    server.use(http.get(`${BASE}/events`, () => HttpResponse.json([])))
    renderSummary()
    await screen.findByText('No upcoming events.')
    expect(screen.getByText('No past events.')).toBeInTheDocument()
  })

  it('shows the error banner when GET /events fails', async () => {
    server.use(
      http.get(`${BASE}/events`, () =>
        HttpResponse.json({ error: 'internal server error' }, { status: 500 })
      )
    )
    renderSummary()
    await screen.findByText('internal server error')
  })

  it('renders the page heading and create button together in the header', async () => {
    renderSummary()
    await screen.findByText('Summer Party')
    expect(screen.getByRole('heading', { name: /^events$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create event/i })).toBeInTheDocument()
  })

  it('opens the create event modal when "+ Create Event" is clicked', async () => {
    renderSummary()
    await screen.findByText('Summer Party')
    await userEvent.click(screen.getByRole('button', { name: /create event/i }))
    expect(screen.getByRole('heading', { name: /new event/i })).toBeInTheDocument()
  })

  it('submits the create form and navigates to the new event', async () => {
    renderSummary()
    await screen.findByText('Summer Party')
    await userEvent.click(screen.getByRole('button', { name: /create event/i }))

    await userEvent.type(screen.getByRole('textbox', { name: /name/i }), 'Birthday Bash')
    await userEvent.type(screen.getByLabelText(/date/i), '2026-12-25T18:00')
    await userEvent.type(screen.getByRole('textbox', { name: /location/i }), 'My House')
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }))

    await screen.findByText('Event Details Page')
  })

  it('clicking an event row navigates to /event/:id', async () => {
    renderSummary()
    await screen.findByText('Summer Party')
    await userEvent.click(screen.getByText('Summer Party'))
    await screen.findByText('Event Details Page')
  })
})
