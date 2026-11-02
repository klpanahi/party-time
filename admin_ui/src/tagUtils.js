// Interest tags on contacts ("hiking", "board games"). The backend stores them
// normalized the same way normalizeTag does, so comparing normalized strings
// here matches what the API will save.

export function normalizeTag(tag) {
  return tag.trim().split(/\s+/).join(' ').toLowerCase()
}

// Every distinct tag across the contacts, sorted. There's no tags endpoint:
// a tag exists while some contact carries it.
export function allTagsOf(contacts) {
  return [...new Set(contacts.flatMap((c) => c.tags ?? []))].sort()
}

// A contact matches when it has ANY of the selected tags (or nothing is
// selected) — the filter is for building an invite list out of several groups.
export function matchesTags(contact, selected) {
  if (selected.length === 0) return true
  const tags = contact.tags ?? []
  return selected.some((t) => tags.includes(t))
}
