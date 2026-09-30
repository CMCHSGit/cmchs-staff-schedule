import { useRef, useState } from 'react'
import { X } from 'lucide-react'

/** "Starship / Cass Office" ⇄ ['Starship', 'Cass Office'] — how a day with several places is stored. */
const SEPARATOR = ' / '
const splitParts = value => (value || '').split('/').map(p => p.trim()).filter(Boolean)
const sameText = (a, b) => a.toLowerCase() === b.toLowerCase()

/**
 * Location picker for one day that can hold several places — each one a chip,
 * saved as a single line joined with " / " (the way the Excel writes them), so
 * colours, Team week and the Excel copy all read it unchanged.
 *
 * Pick a suggestion or type one and press Enter (or just move on) to add it.
 * Picking one closes the list, so a second place is never added by accident —
 * click the box again to reopen it and add another. × or Backspace in the
 * empty box removes one. Anything typed that isn't a known location also goes
 * to onNewValue, so it becomes a suggestion right away.
 */
export default function LocationCombobox({ value, options, onChange, onNewValue, tint, tintFg, placeholder = 'Type or pick a location…', id }) {
  const parts = splitParts(value)
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef(null)

  const available = options.filter(o => !parts.some(p => sameText(p, o)))
  const query = text.trim().toLowerCase()
  const matches = query ? available.filter(o => o.toLowerCase().includes(query)) : available

  function setParts(next) {
    onChange(next.join(SEPARATOR))
  }

  function add(raw) {
    const place = raw.trim()
    setText('')
    setHighlight(0)
    // One pick, one place: the list closes rather than staying open under the
    // cursor, where the next click would silently add a second location.
    setOpen(false)
    if (!place || parts.some(p => sameText(p, place))) return
    setParts([...parts, place])
    if (!options.some(o => sameText(o, place))) onNewValue?.(place)
  }

  function remove(index) {
    setParts(parts.filter((_, i) => i !== index))
    inputRef.current?.focus()
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      add(query && matches[highlight] ? matches[highlight] : text)
    } else if (e.key === 'Backspace' && !text && parts.length) {
      setParts(parts.slice(0, -1))
    } else if (e.key === 'Escape') {
      setText('')
      setOpen(false)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setHighlight(h => Math.min(h + 1, matches.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight(h => Math.max(h - 1, 0))
    }
  }

  return (
    <div className="combobox">
      <div
        className="input combobox-input combobox-multi"
        // backgroundColor, never the background shorthand — that would wipe
        // out the dropdown chevron, which is this box's background-image.
        style={tint ? { backgroundColor: tint, ...(tintFg && { color: tintFg }) } : undefined}
        onMouseDown={e => { if (e.target === e.currentTarget) { e.preventDefault(); inputRef.current?.focus(); setOpen(true) } }}
      >
        {parts.map((p, i) => (
          <span key={p + i} className="location-chip">
            {p}
            <button
              type="button"
              className="location-chip-remove"
              aria-label={`Remove ${p}`}
              onMouseDown={e => e.preventDefault()}
              onClick={() => remove(i)}
            >
              <X size={13} aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id={id}
          className="combobox-text"
          value={text}
          placeholder={parts.length ? 'Add another…' : placeholder}
          autoComplete="off"
          onChange={e => { setText(e.target.value); setOpen(true); setHighlight(0) }}
          onFocus={() => setOpen(true)}
          // Reopens the list after a pick, when the box already has focus and so
          // fires no focus event of its own.
          onClick={() => setOpen(true)}
          // Moving on counts as done: whatever's typed is added, no Enter needed.
          onBlur={() => { add(text); setOpen(false) }}
          onKeyDown={handleKeyDown}
        />
      </div>
      {open && matches.length > 0 && (
        <ul className="combobox-list">
          {matches.map((m, i) => (
            <li key={m}>
              <button
                type="button"
                className={`combobox-option${i === highlight ? ' active' : ''}`}
                // mousedown fires before the box loses focus, so the pick
                // lands before the blur would add the half-typed text instead.
                onMouseDown={e => { e.preventDefault(); add(m) }}
                onMouseEnter={() => setHighlight(i)}
              >
                {m}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
