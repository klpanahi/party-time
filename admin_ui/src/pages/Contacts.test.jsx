import React from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../test/msw/server'
import { BASE, defaultContacts } from '../test/msw/handlers'
import Contacts from './Contacts'

function renderContacts() {
  return render(
    <MemoryRouter>
      <Contacts />
    </MemoryRouter>
  )
}

describe('Contacts', () => {
  it('renders the contact list after loading', async () => {
    renderContacts()
    await screen.findByText('Alice')
    expect(screen.getByText('Bob')).toBeInTheDocument()
  })

  it('shows each contact\'s message type and notes', async () => {
    renderContacts()
    await screen.findByText('Alice')

    const aliceRow = screen.getByText('Alice').closest('tr')
    expect(within(aliceRow).getByText('iMessage')).toBeInTheDocument()

    const bobRow = screen.getByText('Bob').closest('tr')
    expect(within(bobRow).getByText('SMS')).toBeInTheDocument()
    expect(within(bobRow).getByText('Android — iMessage never lands')).toBeInTheDocument()
  })

  it('shows "No contacts yet." when the list is empty', async () => {
    server.use(http.get(`${BASE}/contacts`, () => HttpResponse.json([])))
    renderContacts()
    await screen.findByText('No contacts yet.')
  })

  it('opens the create modal when "+ Add Contact" is clicked', async () => {
    renderContacts()
    await screen.findByText('Alice')
    await userEvent.click(screen.getByRole('button', { name: /add contact/i }))
    expect(screen.getByRole('heading', { name: /new contact/i })).toBeInTheDocument()
  })

  it('creates a contact via POST and reloads the list', async () => {
    let posted
    server.use(
      http.post(`${BASE}/contacts`, async ({ request }) => {
        posted = await request.json()
        return HttpResponse.json({ id: 'new-contact-id' })
      })
    )
    renderContacts()
    await screen.findByText('Alice')
    await userEvent.click(screen.getByRole('button', { name: /add contact/i }))

    await userEvent.type(screen.getByLabelText(/first name/i), 'Carol')
    await userEvent.type(screen.getByLabelText(/phone number/i), '+15550009999')
    await userEvent.type(screen.getByLabelText(/notes/i), 'Works nights')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    // Modal should close — heading disappears
    await screen.findByText('Alice')
    expect(screen.queryByRole('heading', { name: /new contact/i })).not.toBeInTheDocument()
    // A new contact defaults to iMessage without the admin choosing anything.
    expect(posted).toMatchObject({
      first_name: 'Carol',
      message_type: 'imessage',
      notes: 'Works nights',
    })
  })

  it('submits the chosen message type', async () => {
    let posted
    server.use(
      http.post(`${BASE}/contacts`, async ({ request }) => {
        posted = await request.json()
        return HttpResponse.json({ id: 'new-contact-id' })
      })
    )
    renderContacts()
    await screen.findByText('Alice')
    await userEvent.click(screen.getByRole('button', { name: /add contact/i }))

    await userEvent.type(screen.getByLabelText(/first name/i), 'Dana')
    await userEvent.type(screen.getByLabelText(/phone number/i), '+15550008888')
    await userEvent.selectOptions(screen.getByLabelText(/message type/i), 'sms')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await screen.findByText('Alice')
    expect(posted).toMatchObject({ first_name: 'Dana', message_type: 'sms' })
  })

  it('opens the edit modal pre-populated with contact data', async () => {
    renderContacts()
    await screen.findByText('Alice')

    // Click the Edit button in Alice's row
    const aliceRow = screen.getByText('Alice').closest('tr')
    await userEvent.click(within(aliceRow).getByRole('button', { name: /edit/i }))

    expect(screen.getByRole('heading', { name: /edit contact/i })).toBeInTheDocument()
    expect(screen.getByDisplayValue('Alice')).toBeInTheDocument()
    expect(screen.getByDisplayValue('+15550001111')).toBeInTheDocument()
    expect(screen.getByLabelText(/message type/i)).toHaveValue('imessage')
    expect(screen.getByLabelText(/notes/i)).toHaveValue('')
  })

  it('pre-populates message type and notes for an SMS contact', async () => {
    renderContacts()
    await screen.findByText('Bob')

    const bobRow = screen.getByText('Bob').closest('tr')
    await userEvent.click(within(bobRow).getByRole('button', { name: /edit/i }))

    expect(screen.getByLabelText(/message type/i)).toHaveValue('sms')
    expect(screen.getByLabelText(/notes/i)).toHaveValue('Android — iMessage never lands')
  })

  it('saves a message type change via PUT', async () => {
    let put
    server.use(
      http.put(`${BASE}/contacts/:id`, async ({ request }) => {
        put = await request.json()
        return HttpResponse.json({ ok: true })
      })
    )
    renderContacts()
    await screen.findByText('Alice')

    const aliceRow = screen.getByText('Alice').closest('tr')
    await userEvent.click(within(aliceRow).getByRole('button', { name: /edit/i }))
    await userEvent.selectOptions(screen.getByLabelText(/message type/i), 'sms')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await screen.findByText('Alice')
    expect(put).toMatchObject({ first_name: 'Alice', message_type: 'sms' })
  })

  it('saves an edit via PUT and closes the modal', async () => {
    renderContacts()
    await screen.findByText('Alice')

    const aliceRow = screen.getByText('Alice').closest('tr')
    await userEvent.click(within(aliceRow).getByRole('button', { name: /edit/i }))

    const firstNameInput = screen.getByDisplayValue('Alice')
    await userEvent.clear(firstNameInput)
    await userEvent.type(firstNameInput, 'Alicia')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await screen.findByText('Alice') // list reloads from handler (still returns Alice)
    expect(screen.queryByRole('heading', { name: /edit contact/i })).not.toBeInTheDocument()
  })

  it('shows the error banner in the modal when the API call fails', async () => {
    server.use(
      http.post(`${BASE}/contacts`, () =>
        HttpResponse.json({ error: 'validation failed' }, { status: 422 })
      )
    )
    renderContacts()
    await screen.findByText('Alice')
    await userEvent.click(screen.getByRole('button', { name: /add contact/i }))

    await userEvent.type(screen.getByLabelText(/first name/i), 'Carol')
    await userEvent.type(screen.getByLabelText(/phone number/i), '+15550009999')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await screen.findByText('validation failed')
  })
})
