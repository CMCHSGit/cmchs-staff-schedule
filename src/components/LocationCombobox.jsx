import { useEffect, useRef, useState } from 'react'

/**
 * Type-to-filter location picker. Selecting a suggestion or typing a new
 * value both call onChange; typing a value with no matching option also
 * calls onNewValue, so the caller can offer it as a suggestion right away
 * (before it's actually persisted anywhere).
 */
export default function LocationCombobox({ value, options, onChange, onNewValue }) {
  const [text, setText] = useState(value || '')
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const blurTimer = useRef(null)

  useEffect(() => setText(value || ''), [value])
  useEffect(() => () => clearTimeout(blurTimer.current), [])

  // Show every option (like a native <select>) until the person actually
  // types something different from the current value — only then filter.
  const isFiltering = text.trim() !== '' && text !== (value || '')
  const matches = isFiltering
    ? options.filter(o => o.toLowerCase().includes(text.trim().toLowerCase()))
    : options

  function commit(newValue) {
    const trimmed = newValue.trim()
    setText(trimmed)
    setOpen(false)
    onChange(trimmed)
    if (trimmed && !options.some(o => o.toLowerCase() === trimmed.toLowerCase())) {
      onNewValue?.(trimmed)
    }
  }

  function handleBlur() {
    // Delay so a suggestion's onMouseDown still fires before we close/commit.
    blurTimer.current = setTimeout(() => commit(text), 150)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit(matches[highlight] ?? text)
    } else if (e.key === 'Escape') {
      setText(value || '')
      setOpen(false)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight(h => Math.min(h + 1, matches.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight(h => Math.max(h - 1, 0))
    }
  }

  return (
    <div className="combobox">
      <input
        className="input combobox-input"
        value={text}
        placeholder="Type or pick a location…"
        onChange={e => { setText(e.target.value); setOpen(true); setHighlight(0) }}
        onFocus={() => setOpen(true)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      />
      {open && matches.length > 0 && (
        <ul className="combobox-list">
          {matches.map((m, i) => (
            <li key={m}>
              <button
                type="button"
                className={`combobox-option${i === highlight ? ' active' : ''}`}
                onMouseDown={() => commit(m)}
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
