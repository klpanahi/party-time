import { describe, expect, it } from 'vitest'
import { toDatetimeLocal, formatDateShort } from './dateUtils'

describe('toDatetimeLocal', () => {
  it('returns empty string for null', () => {
    expect(toDatetimeLocal(null)).toBe('')
  })

  it('returns empty string for undefined', () => {
    expect(toDatetimeLocal(undefined)).toBe('')
  })

  it('returns empty string for an invalid date string', () => {
    expect(toDatetimeLocal('not-a-date')).toBe('')
  })

  it('returns YYYY-MM-DDTHH:MM for a valid ISO string', () => {
    const iso = '2025-03-07T18:00:00.000Z'
    const result = toDatetimeLocal(iso)
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  })

  it('pads single-digit month and day', () => {
    const d = new Date(2025, 0, 5, 6, 3) // Jan 5 2025 06:03 local
    const result = toDatetimeLocal(d.toISOString())
    expect(result).toMatch(/^\d{4}-01-05T06:03$/)
  })
})

describe('formatDateShort', () => {
  it('returns em-dash for null', () => {
    expect(formatDateShort(null)).toBe('—')
  })

  it('returns em-dash for undefined', () => {
    expect(formatDateShort(undefined)).toBe('—')
  })

  it('returns em-dash for an invalid date string', () => {
    expect(formatDateShort('not-a-date')).toBe('—')
  })

  it('returns a formatted string for a valid ISO date', () => {
    const d = new Date(2025, 2, 7, 18, 0) // Mar 7 2025 6:00 PM local
    const result = formatDateShort(d.toISOString())
    expect(result).toContain('2025')
    expect(result).toContain('Mar')
    expect(result).toContain('7')
  })
})
