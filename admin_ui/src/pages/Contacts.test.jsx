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
    await userEvent.type(screen.getByLabelText(/phone number/i), '+15125559999')
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
    await userEvent.type(screen.getByLabelText(/phone number/i), '+15125558888')
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
    expect(screen.getByDisplayValue('+1 (512)555-1111')).toBeInTheDocument()
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
    await userEvent.type(screen.getByLabelText(/phone number/i), '+15125559999')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await screen.findByText('validation failed')
  })

  it('shows phone numbers in one consistent format', async () => {
    renderContacts()
    await screen.findByText('Alice')
    const aliceRow = screen.getByText('Alice').closest('tr')
    expect(within(aliceRow).getByText('+1 (512)555-1111')).toBeInTheDocument()
  })

  it('normalizes a number typed in any format before sending it', async () => {
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

    await userEvent.type(screen.getByLabelText(/first name/i), 'Erin')
    await userEvent.type(screen.getByLabelText(/phone number/i), '(512)350-0064')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await screen.findByText('Alice')
    expect(posted).toMatchObject({ first_name: 'Erin', phone_number: '+1 (512)350-0064' })
  })

  it('shows an inline error and saves nothing when the number cannot be parsed', async () => {
    let posted = false
    server.use(
      http.post(`${BASE}/contacts`, () => {
        posted = true
        return HttpResponse.json({ id: 'new-contact-id' })
      })
    )
    renderContacts()
    await screen.findByText('Alice')
    await userEvent.click(screen.getByRole('button', { name: /add contact/i }))

    await userEvent.type(screen.getByLabelText(/first name/i), 'Erin')
    const phone = screen.getByLabelText(/phone number/i)
    await userEvent.type(phone, '12345')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't read that as a phone number/i)
    expect(phone).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('heading', { name: /new contact/i })).toBeInTheDocument()
    expect(posted).toBe(false)

    // Editing the field clears the error so it can be re-entered.
    await userEvent.type(phone, '6')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(phone).not.toHaveAttribute('aria-invalid')
  })

  it('rejects an unparseable number on edit without sending a PUT', async () => {
    let put = false
    server.use(
      http.put(`${BASE}/contacts/:id`, () => {
        put = true
        return HttpResponse.json({ ok: true })
      })
    )
    renderContacts()
    await screen.findByText('Alice')
    const aliceRow = screen.getByText('Alice').closest('tr')
    await userEvent.click(within(aliceRow).getByRole('button', { name: /edit/i }))

    const phone = screen.getByLabelText(/phone number/i)
    await userEvent.clear(phone)
    await userEvent.type(phone, 'not a number')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    expect(screen.getByRole('alert')).toHaveTextContent(/please re-enter it/i)
    expect(put).toBe(false)
  })

  it('sends the edited contact\'s existing number back in canonical form', async () => {
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
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await screen.findByText('Alice')
    expect(put).toMatchObject({ phone_number: '+1 (512)555-1111' })
  })
})

describe('Contacts interest tags', () => {
  it('shows each contact\'s tags and a dash for none', async () => {
    server.use(http.get(`${BASE}/contacts`, () => HttpResponse.json([
      ...defaultContacts,
      { id: 'contact-ghi', first_name: 'Cara', last_name: 'Nope', phone_number: '+15125553333', message_type: 'imessage', notes: '', tags: [] },
    ])))
    renderContacts()
    await screen.findByText('Alice')
    const bobRow = screen.getByText('Bob').closest('tr')
    expect(within(bobRow).getByText('board games')).toBeInTheDocument()
    expect(within(bobRow).getByText('hiking')).toBeInTheDocument()
    const caraRow = screen.getByText('Cara').closest('tr')
    // Last name present, notes and tags empty → two dashes
    expect(within(caraRow).getAllByText('—')).toHaveLength(2)
  })

  it('filters the list by tag, OR-ing several, and clears', async () => {
    renderContacts()
    await screen.findByText('Alice')

    await userEvent.click(screen.getByRole('button', { name: 'board games' }))
    expect(screen.queryByText('Alice')).not.toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'board games' })).toHaveAttribute('aria-pressed', 'true')

    // Adding hiking widens the filter: Alice has hiking.
    await userEvent.click(screen.getByRole('button', { name: 'hiking' }))
    expect(screen.getByText('Alice')).toBeInTheDocument()

    // Deselecting board games leaves hiking only — both still match.
    await userEvent.click(screen.getByRole('button', { name: 'board games' }))
    expect(screen.getByText('Bob')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /clear/i }))
    expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument()
  })

  it('keeps a selected tag switchable after the last contact loses it', async () => {
    // Bob is the only "board games" contact; the reload after saving him
    // returns him without it.
    let calls = 0
    server.use(http.get(`${BASE}/contacts`, () => {
      calls += 1
      return HttpResponse.json(calls === 1
        ? defaultContacts
        : defaultContacts.map((c) => ({ ...c, tags: c.id === 'contact-def' ? ['hiking', 'wine'] : c.tags })))
    }))
    renderContacts()
    await screen.findByText('Alice')
    await userEvent.click(screen.getByRole('button', { name: 'board games' }))
    // Edit and save Bob to trigger a reload where nobody has "board games".
    await userEvent.click(within(screen.getByText('Bob').closest('tr')).getByRole('button', { name: /edit/i }))
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await screen.findByText('No contacts have those interests.')

    await userEvent.click(screen.getByRole('button', { name: 'board games' }))
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'board games' })).not.toBeInTheDocument()
  })

  it('hides the filter bar when no contact has tags', async () => {
    server.use(http.get(`${BASE}/contacts`, () =>
      HttpResponse.json(defaultContacts.map((c) => ({ ...c, tags: [] })))))
    renderContacts()
    await screen.findByText('Alice')
    expect(screen.queryByRole('group', { name: /filter by interest/i })).not.toBeInTheDocument()
  })

  it('adds tags with Enter, comma and blur, normalized and deduped, and posts them', async () => {
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
    await userEvent.type(screen.getByLabelText(/phone number/i), '+15125559999')
    const tagInput = screen.getByLabelText(/add interest/i)
    await userEvent.type(tagInput, '  Rock  Climbing {Enter}')
    await userEvent.type(tagInput, 'Wine,')
    await userEvent.type(tagInput, 'wine{Enter}')
    await userEvent.type(tagInput, 'cooking')
    await userEvent.click(screen.getByLabelText(/notes/i)) // blur adds the draft
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    expect(posted.tags).toEqual(['rock climbing', 'wine', 'cooking'])
  })

  it('splits pasted comma-separated text into tags', async () => {
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
    await userEvent.type(screen.getByLabelText(/phone number/i), '+15125559999')
    const tagInput = screen.getByLabelText(/add interest/i)
    await userEvent.click(tagInput)
    await userEvent.paste('Hiking, wine,, Jazz')
    expect(tagInput).toHaveValue(' Jazz')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    expect(posted.tags).toEqual(['hiking', 'wine', 'jazz'])
  })

  it('suggests existing tags and removes tags with × or Backspace', async () => {
    let put
    server.use(
      http.put(`${BASE}/contacts/:id`, async ({ request }) => {
        put = await request.json()
        return HttpResponse.json({ ok: true })
      })
    )
    renderContacts()
    await screen.findByText('Alice')
    await userEvent.click(within(screen.getByText('Alice').closest('tr')).getByRole('button', { name: /edit/i }))
    const modal = within(screen.getByRole('heading', { name: /edit contact/i }).closest('.modal'))

    // Alice starts with hiking; typing "boa" offers "board games".
    expect(modal.getByText('hiking')).toBeInTheDocument()
    const tagInput = modal.getByLabelText(/add interest/i)
    await userEvent.type(tagInput, 'boa')
    await userEvent.click(modal.getByRole('button', { name: 'board games' }))
    expect(tagInput).toHaveValue('')
    // Already-applied tags aren't suggested again.
    await userEvent.type(tagInput, 'hik')
    expect(modal.queryByRole('button', { name: 'hiking' })).not.toBeInTheDocument()
    await userEvent.clear(tagInput)

    await userEvent.click(modal.getByRole('button', { name: 'Remove hiking' }))
    await userEvent.type(tagInput, 'wine{Enter}')
    await userEvent.type(tagInput, '{Backspace}') // empty input → drops the last tag (wine)
    await userEvent.click(modal.getByRole('button', { name: /^save$/i }))

    expect(put.tags).toEqual(['board games'])
  })
})
