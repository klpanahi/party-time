import { describe, expect, it } from 'vitest'
import { allTagsOf, matchesTags, normalizeTag } from './tagUtils'

describe('normalizeTag', () => {
  it('trims, lowercases and collapses inner whitespace like the backend', () => {
    expect(normalizeTag('  Board   Games ')).toBe('board games')
    expect(normalizeTag('   ')).toBe('')
  })
})

describe('allTagsOf', () => {
  it('returns each tag once, sorted, tolerating contacts without tags', () => {
    expect(allTagsOf([
      { tags: ['wine', 'hiking'] },
      { tags: ['hiking'] },
      {},
    ])).toEqual(['hiking', 'wine'])
  })
})

describe('matchesTags', () => {
  it('matches everyone when no tag is selected', () => {
    expect(matchesTags({}, [])).toBe(true)
  })

  it('matches a contact with ANY of the selected tags', () => {
    const c = { tags: ['hiking'] }
    expect(matchesTags(c, ['wine', 'hiking'])).toBe(true)
    expect(matchesTags(c, ['wine'])).toBe(false)
    expect(matchesTags({}, ['wine'])).toBe(false)
  })
})
