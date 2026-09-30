import { useEffect, useRef, useState } from 'react'

const clamp = (n, lo, hi) => Math.max(lo, Math.min(n, hi))

/** Cells the way Excel puts them on the clipboard: tabs between columns, newlines between rows. */
const toTSV = grid => grid.map(row => row.join('\t')).join('\n')
const fromTSV = text => text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n').map(line => line.split('\t'))

/**
 * Excel-style selection, typing and copy/paste for a grid of day cells — rows
 * are whatever the caller is listing (people), columns are weekdays (0-4).
 * Click a cell and type to replace it, F2 or double-click to edit what's
 * there, arrows/Tab/Enter to move, Delete to clear, drag or Shift-click to
 * select a range, and Ctrl+C / Ctrl+V to copy and paste a block — including
 * to and from Excel itself.
 *
 * The trick behind the clipboard part: a hidden, always-focused textarea
 * carries the actual selected text, kept in sync with the current
 * selection, so a real Ctrl+C copies real text and a real Ctrl+V fires a
 * real 'paste' event — no clipboard permission prompts, and it behaves
 * exactly like copying out of any other text field.
 *
 * `valueOf(r, c)` and `canEdit(r)` read the model; `onApply(changes)` gets
 * `[{ r, c, location }]` for whatever the caller is meant to save, and
 * `onDenied()` fires when an edit or paste touched a row that isn't editable.
 */
export default function useWeekGrid({ rowCount, colCount = 5, valueOf, canEdit, onApply, onDenied }) {
  const [sel, setSel] = useState({ r: 0, c: 0, r2: 0, c2: 0 })
  const [editing, setEditing] = useState(null) // { r, c, text }
  const [active, setActive] = useState(false)  // a cell has been used, so the grid may take focus
  const textareaRef = useRef(null)
  const dragging = useRef(false)

  const r1 = Math.min(sel.r, sel.r2), r2 = Math.max(sel.r, sel.r2)
  const c1 = Math.min(sel.c, sel.c2), c2 = Math.max(sel.c, sel.c2)

  useEffect(() => {
    const stop = () => { dragging.current = false }
    window.addEventListener('mouseup', stop)
    return () => window.removeEventListener('mouseup', stop)
  }, [])

  // Keep the hidden textarea holding (and having selected) exactly what a
  // copy right now should produce, so the browser's own Ctrl+C just works.
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta || !active || editing) return
    const grid = []
    for (let r = r1; r <= r2; r++) {
      const row = []
      for (let c = c1; c <= c2; c++) row.push(valueOf(r, c))
      grid.push(row)
    }
    ta.value = toTSV(grid)
    ta.focus({ preventScroll: true })
    ta.select()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, editing, sel.r, sel.c, sel.r2, sel.c2, rowCount, colCount])

  const inBounds = (r, c) => r >= 0 && r < rowCount && c >= 0 && c < colCount

  function select(r, c, extend) {
    if (!inBounds(r, c)) return
    setActive(true)
    setEditing(null)
    setSel(s => (extend ? { ...s, r2: r, c2: c } : { r, c, r2: r, c2: c }))
  }

  function beginDrag(r, c) { dragging.current = true; select(r, c, false) }
  function dragOver(r, c) { if (dragging.current) select(r, c, true) }

  function move(dr, dc, extend) {
    setEditing(null)
    setSel(s => {
      const nr = clamp(s.r2 + dr, 0, rowCount - 1)
      const nc = clamp(s.c2 + dc, 0, colCount - 1)
      return extend ? { ...s, r2: nr, c2: nc } : { r: nr, c: nc, r2: nr, c2: nc }
    })
  }

  /** seed null keeps what's already there (F2, double-click); a string replaces it (typing over it). */
  function startEdit(r, c, seed) {
    if (!inBounds(r, c)) return
    if (!canEdit(r)) return onDenied?.()
    setActive(true)
    setSel({ r, c, r2: r, c2: c })
    setEditing({ r, c, text: seed === null ? valueOf(r, c) : seed })
  }

  function updateEditing(text) { setEditing(e => (e ? { ...e, text } : e)) }

  function commitEdit(dr = 0, dc = 0) {
    setEditing(e => {
      if (e && e.text.trim() !== valueOf(e.r, e.c)) onApply([{ r: e.r, c: e.c, location: e.text.trim() }])
      return null
    })
    if (dr || dc) move(dr, dc, false)
    else textareaRef.current?.focus({ preventScroll: true })
  }

  function cancelEdit() {
    setEditing(null)
    textareaRef.current?.focus({ preventScroll: true })
  }

  function clearSelection() {
    const changes = []
    let denied = false
    for (let r = r1; r <= r2; r++) {
      if (!canEdit(r)) { denied = true; continue }
      for (let c = c1; c <= c2; c++) if (valueOf(r, c)) changes.push({ r, c, location: '' })
    }
    if (changes.length) onApply(changes)
    else if (denied) onDenied?.()
  }

  function handleCopy() {
    // The textarea already holds (and has selected) the right text — let
    // the browser's own copy run rather than racing it with our own.
  }

  function handleCut() {
    if (editing) return
    clearSelection()
  }

  function handlePaste(e) {
    if (editing) return
    e.preventDefault()
    const block = fromTSV(e.clipboardData.getData('text/plain'))
    if (!block.length || !block[0].length) return
    // One copied cell fills the whole current selection, like Excel;
    // anything bigger anchors at the selection's top-left and can run past it.
    const single = block.length === 1 && block[0].length === 1
    const rows = single ? r2 - r1 + 1 : block.length
    const cols = single ? c2 - c1 + 1 : Math.max(...block.map(row => row.length))
    const changes = []
    let denied = false
    for (let dr = 0; dr < rows; dr++) {
      const r = r1 + dr
      if (r >= rowCount) break
      if (!canEdit(r)) { denied = true; continue }
      const srcRow = block[dr % block.length]
      for (let dc = 0; dc < cols; dc++) {
        const c = c1 + dc
        if (c >= colCount) break
        changes.push({ r, c, location: (single ? block[0][0] : srcRow[dc % srcRow.length] ?? '').trim() })
      }
    }
    if (changes.length) onApply(changes)
    else if (denied) onDenied?.()
    setSel({ r: r1, c: c1, r2: Math.min(r1 + rows - 1, rowCount - 1), c2: Math.min(c1 + cols - 1, colCount - 1) })
  }

  function handleKeyDown(e) {
    const { key, shiftKey, ctrlKey, metaKey } = e
    if (ctrlKey || metaKey) return // Ctrl+C/V/X reach the copy/cut/paste handlers untouched
    if (key === 'ArrowDown') { e.preventDefault(); move(1, 0, shiftKey) }
    else if (key === 'ArrowUp') { e.preventDefault(); move(-1, 0, shiftKey) }
    else if (key === 'ArrowLeft') { e.preventDefault(); move(0, -1, shiftKey) }
    else if (key === 'ArrowRight') { e.preventDefault(); move(0, 1, shiftKey) }
    else if (key === 'Tab') { e.preventDefault(); move(0, shiftKey ? -1 : 1, false) }
    else if (key === 'Enter' || key === 'F2') { e.preventDefault(); startEdit(sel.r2, sel.c2, null) }
    else if (key === 'Delete' || key === 'Backspace') { e.preventDefault(); clearSelection() }
    else if (key.length === 1) { e.preventDefault(); startEdit(sel.r2, sel.c2, key) }
  }

  return {
    editing,
    isSelected: (r, c) => r >= r1 && r <= r2 && c >= c1 && c <= c2,
    isAnchor: (r, c) => r === sel.r2 && c === sel.c2,
    cellHandlers: (r, c) => ({
      onMouseDown: e => {
        e.preventDefault()
        // Shift-click extends from the anchor, like Excel; a plain click
        // starts a fresh drag-selectable range.
        if (e.shiftKey) select(r, c, true)
        else beginDrag(r, c)
      },
      onMouseEnter: () => dragOver(r, c),
      onDoubleClick: () => startEdit(r, c, null),
    }),
    editingInputProps: editing && {
      value: editing.text,
      onChange: e => updateEditing(e.target.value),
      onKeyDown: e => {
        e.stopPropagation()
        if (e.key === 'Enter') { e.preventDefault(); commitEdit(1, 0) }
        else if (e.key === 'Tab') { e.preventDefault(); commitEdit(0, e.shiftKey ? -1 : 1) }
        else if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
      },
      onBlur: () => commitEdit(),
      autoFocus: true,
    },
    catcherProps: {
      ref: textareaRef,
      className: 'wk-grid-catcher',
      defaultValue: '',
      onKeyDown: handleKeyDown,
      onCopy: handleCopy,
      onCut: handleCut,
      onPaste: handlePaste,
      onFocus: () => setActive(true),
      readOnly: false,
      'aria-hidden': true,
      tabIndex: -1,
    },
  }
}
