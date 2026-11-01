import { describe, expect, it } from 'vitest'
import { normalizePhone, formatPhone, phoneMatches } from './phone'

describe('normalizePhone', () => {
  it.each([
    // The formats already in the contacts table.
    ['(512)350-0064', '+15123500064'],
    ['+1 (512) 364-9131', '+15123649131'],
    ['7373145188', '+17373145188'],
    ['(205) 335-5501', '+12053355501'],
    // Other ways people type a US number.
    ['512.350.0064', '+15123500064'],
    ['1-512-350-0064', '+15123500064'],
    ['  512 350 0064  ', '+15123500064'],
    ['+15123500064', '+15123500064'],
    // Pasted from macOS Contacts: wrapped in invisible direction marks.
    ['\u202d+1 (512) 900-0626\u202c', '+15129000626'],
    ['512\u200b350\u200b0064', '+15123500064'],
    // An explicit country code is kept.
    ['+44 20 7946 0958', '+442079460958'],
  ])('normalizes %j to %s', (input, want) => {
    expect(normalizePhone(input)).toBe(want)
  })

  it.each([
    '', '   ', 'call me maybe', '12345', '512350006412345', '(555) 000-1111', '+1 (012) 350-0064',
    undefined, null,
  ])('rejects %j', (input) => {
    expect(normalizePhone(input)).toBeNull()
  })
})

describe('formatPhone', () => {
  it('shows a stored number in international format', () => {
    expect(formatPhone('+15123500064')).toBe('+1 512 350 0064')
    expect(formatPhone('+442079460958')).toBe('+44 20 7946 0958')
  })

  it('formats a number saved before normalization the same way', () => {
    expect(formatPhone('(512)350-0064')).toBe('+1 512 350 0064')
  })

  it('shows unparseable input as stored', () => {
    expect(formatPhone('garbage')).toBe('garbage')
    expect(formatPhone(undefined)).toBe('')
  })
})

describe('phoneMatches', () => {
  it('matches on digits regardless of punctuation', () => {
    expect(phoneMatches('+15123500064', '(512) 350')).toBe(true)
    expect(phoneMatches('+15123500064', '350-0064')).toBe(true)
  })

  it('does not match a query with no digits or different digits', () => {
    expect(phoneMatches('+15123500064', 'alice')).toBe(false)
    expect(phoneMatches('+15123500064', '999')).toBe(false)
    expect(phoneMatches(undefined, '512')).toBe(false)
  })
})
