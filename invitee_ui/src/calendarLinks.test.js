import { describe, expect, it } from 'vitest'
import {
  buildGoogleCalendarUrl,
  buildICS,
  hasCalendarData,
  icsFilename,
} from './calendarLinks'

const invite = {
  invite_id: 'abc-123',
  event_name: 'Birthday Bash',
  event_date: '2099-07-04T23:00:00Z',
  event_end_time: '2099-07-05T03:30:00Z',
  event_location: '123 Party Lane',
  event_description: 'Come celebrate!',
}

function lineFor(ics, prop) {
  return ics.split('\r\n').find((l) => l.startsWith(`${prop}:`))
}

describe('buildICS', () => {
  it('emits a well-formed VCALENDAR wrapping a single VEVENT', () => {
    const ics = buildICS(invite)
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0')).toBe(true)
    expect(ics.endsWith('END:VEVENT\r\nEND:VCALENDAR')).toBe(true)
    expect(ics.split('\r\n')).toContain('BEGIN:VEVENT')
  })

  it('writes start and end as basic-format UTC timestamps', () => {
    const ics = buildICS(invite)
    expect(lineFor(ics, 'DTSTART')).toBe('DTSTART:20990704T230000Z')
    expect(lineFor(ics, 'DTEND')).toBe('DTEND:20990705T033000Z')
  })

  it('carries the summary, location and description', () => {
    const ics = buildICS(invite)
    expect(lineFor(ics, 'SUMMARY')).toBe('SUMMARY:Birthday Bash')
    expect(lineFor(ics, 'LOCATION')).toBe('LOCATION:123 Party Lane')
    expect(lineFor(ics, 'DESCRIPTION')).toBe('DESCRIPTION:Come celebrate!')
  })

  it('uses the invite id as a stable UID', () => {
    expect(lineFor(buildICS(invite), 'UID')).toBe('UID:abc-123@party-time')
  })

  it('escapes separators and newlines in text values', () => {
    const ics = buildICS({
      ...invite,
      event_name: 'Cake, Punch; and more',
      event_description: 'Line one\nline two \\ done',
    })
    expect(lineFor(ics, 'SUMMARY')).toBe('SUMMARY:Cake\\, Punch\\; and more')
    expect(lineFor(ics, 'DESCRIPTION')).toBe('DESCRIPTION:Line one\\nline two \\\\ done')
  })

  it('folds content lines longer than 75 octets onto continuation lines', () => {
    const ics = buildICS({ ...invite, event_description: 'x'.repeat(200) })
    for (const line of ics.split('\r\n')) {
      expect(line.length).toBeLessThanOrEqual(75)
    }
    // Continuation lines are marked by a single leading space.
    expect(ics).toContain('\r\n x')
  })

  it('omits optional properties that are absent', () => {
    const ics = buildICS({ ...invite, event_location: '', event_description: '' })
    expect(lineFor(ics, 'LOCATION')).toBeUndefined()
    expect(lineFor(ics, 'DESCRIPTION')).toBeUndefined()
  })
})

describe('buildGoogleCalendarUrl', () => {
  it('builds a TEMPLATE render URL with the event window', () => {
    const url = new URL(buildGoogleCalendarUrl(invite))
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render')
    expect(url.searchParams.get('action')).toBe('TEMPLATE')
    expect(url.searchParams.get('text')).toBe('Birthday Bash')
    expect(url.searchParams.get('dates')).toBe('20990704T230000Z/20990705T033000Z')
    expect(url.searchParams.get('location')).toBe('123 Party Lane')
    expect(url.searchParams.get('details')).toBe('Come celebrate!')
  })

  it('percent-encodes values rather than breaking the query string', () => {
    const raw = buildGoogleCalendarUrl({ ...invite, event_name: 'Cake & Punch' })
    expect(raw).not.toContain('Cake & Punch')
    expect(new URL(raw).searchParams.get('text')).toBe('Cake & Punch')
  })
})

describe('hasCalendarData', () => {
  it('is true when both ends of the window parse', () => {
    expect(hasCalendarData(invite)).toBe(true)
  })

  it('is false when the end time is missing or unparseable', () => {
    expect(hasCalendarData({ ...invite, event_end_time: undefined })).toBe(false)
    expect(hasCalendarData({ ...invite, event_end_time: 'not-a-date' })).toBe(false)
    expect(hasCalendarData(null)).toBe(false)
  })
})

describe('icsFilename', () => {
  it('slugifies the event name', () => {
    expect(icsFilename(invite)).toBe('birthday-bash.ics')
    expect(icsFilename({ event_name: 'Cake, Punch & More!' })).toBe('cake-punch-more.ics')
  })

  it('falls back to a generic name when nothing usable remains', () => {
    expect(icsFilename({ event_name: '!!!' })).toBe('event.ics')
    expect(icsFilename({})).toBe('event.ics')
  })
})
