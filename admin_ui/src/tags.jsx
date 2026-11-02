import { useState } from 'react'
import { normalizeTag } from './tagUtils'

// Display and editing components for contact interest tags. The matching and
// normalization rules live in tagUtils.js.

export function TagChips({ tags }) {
  if (!tags || tags.length === 0) return null
  return (
    <span className="tag-chips">
      {tags.map((t) => <span key={t} className="tag-chip">{t}</span>)}
    </span>
  )
}

// Toggleable chips for filtering a list by tag. Renders nothing when no
// contact has a tag yet. A selected tag stays listed even after the last
// contact carrying it loses it, so it can still be switched off.
export function TagFilter({ allTags, selected, onChange }) {
  const chips = [...new Set([...allTags, ...selected])].sort()
  if (chips.length === 0) return null

  function toggle(tag) {
    onChange(selected.includes(tag) ? selected.filter((t) => t !== tag) : [...selected, tag])
  }

  return (
    <div className="tag-filter" role="group" aria-label="Filter by interest">
      <span className="tag-filter-label">Interests:</span>
      {chips.map((t) => (
        <button
          key={t}
          type="button"
          className={selected.includes(t) ? 'tag-chip tag-chip-toggle active' : 'tag-chip tag-chip-toggle'}
          aria-pressed={selected.includes(t)}
          onClick={() => toggle(t)}
        >
          {t}
        </button>
      ))}
      {selected.length > 0 && (
        <button type="button" className="link-btn" onClick={() => onChange([])}>Clear</button>
      )}
    </div>
  )
}

// Editor for one contact's tags: Enter or comma adds what's typed, × removes a
// tag, and existing tags matching the input are offered as suggestions.
export function TagInput({ value, onChange, suggestions }) {
  const [draft, setDraft] = useState('')

  function add(...raws) {
    const next = [...value]
    for (const raw of raws) {
      const tag = normalizeTag(raw)
      if (tag && !next.includes(tag)) next.push(tag)
    }
    if (next.length !== value.length) onChange(next)
    setDraft('')
  }

  // Commas that arrive without a keydown (a paste, autocorrect) still split
  // the text into tags; whatever follows the last comma stays as the draft.
  function handleChange(e) {
    const parts = e.target.value.split(',')
    if (parts.length > 1) {
      add(...parts.slice(0, -1))
      setDraft(parts[parts.length - 1])
    } else {
      setDraft(e.target.value)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      add(draft)
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      onChange(value.slice(0, -1))
    }
  }

  const q = normalizeTag(draft)
  const matches = q
    ? suggestions.filter((s) => s.includes(q) && !value.includes(s) && s !== q).slice(0, 6)
    : []

  return (
    <div className="tag-input">
      <div className="tag-input-box">
        {value.map((t) => (
          <span key={t} className="tag-chip">
            {t}
            <button type="button" className="tag-remove" aria-label={`Remove ${t}`}
              onClick={() => onChange(value.filter((v) => v !== t))}>×</button>
          </span>
        ))}
        <input
          aria-label="Add interest"
          placeholder={value.length === 0 ? 'e.g. hiking, board games' : ''}
          value={draft}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={() => draft.trim() && add(draft)}
        />
      </div>
      {matches.length > 0 && (
        <div className="tag-suggestions">
          {matches.map((s) => (
            // onMouseDown so the click lands before the input's blur adds the draft.
            <button key={s} type="button" className="tag-chip tag-chip-toggle"
              onMouseDown={(e) => { e.preventDefault(); add(s) }}>
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
