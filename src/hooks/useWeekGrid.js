import { useEffect, useRef, useState } from 'react'
import { boundingRange, fillAllPlan, fillDownPlan, fillPlan, fromTSV, moveTarget, pastePlan, rangeOf, selectionOf, toTSV } from '../utils/gridOps'

const ARROW_STEP = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
const MOVE_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'])

/**
 * Excel-style selection, typing, copy/paste and fill for a grid of day cells — rows are whatever the
 * caller is listing (people), columns are weekdays (0-4).
 *
 * Click a cell and type to replace it, F2 or double-click to edit what's there (clicking another cell
 * keeps what you typed). Arrows/Tab/Enter move, and Home/End/PageUp/PageDown/Ctrl+arrows go further; a
 * range is selected by dragging, Shift-click or Shift+arrows, Ctrl+A for everything. Delete clears.
 * Ctrl+C / Ctrl+X / Ctrl+V copy, cut and paste a block — including to and from Excel itself — and what
 * is copied or cut is outlined until it's used. One copied cell fills a selected range, a block repeats
 * across a selection that is a whole number of blocks, and a cut moves rather than copies. Ctrl+D fills
 * down, Ctrl+Enter puts what you typed into every selected cell, and the small square on the corner of
 * the selection fills by dragging. Ctrl+Z / Ctrl+Y undo and redo — what they do is up to the caller.
 *
 * The trick behind the clipboard part: a hidden, always-focused textarea receives the real copy, cut
 * and paste events, so there are no clipboard permission prompts and it behaves exactly like copying
 * out of any other text field.
 *
 * `valueOf(r, c)` and `canEdit(r)` read the model; `onApply(changes)` gets `[{ r, c, location }]` for
 * whatever the caller is meant to save, and `onDenied()` fires when an edit touched a row that isn't
 * editable. The cells must carry `cellHandlers(r, c)`, which includes a `data-cell` the grid uses to
 * keep the active cell in view. `resetKey` changes whenever the cells stop meaning what they did (another
 * week, a different list of people): what was copied or cut is forgotten then, so a cut can never empty
 * the wrong cells.
 */
export default function useWeekGrid({ rowCount, colCount = 5, valueOf, canEdit, onApply, onDenied, onUndo, onRedo, resetKey }) {
  const [sel, setSel] = useState({ r: 0, c: 0, r2: 0, c2: 0 })
  const [editing, setEditingState] = useState(null) // { r, c, text, typed }
  const [active, setActive] = useState(false)       // a cell has been used, so the grid may take focus
  const [clip, setClip] = useState(null)            // { r1, c1, r2, c2, text, cut } — what was copied or cut
  const [fill, setFill] = useState(null)            // { src, to } while the fill handle is being dragged
  const textareaRef = useRef(null)
  const dragging = useRef(false)
  const editingRef = useRef(null)
  const fillRef = useRef(null)
  const needScroll = useRef(false)
  // The latest of everything the handlers need, for the ones that run outside a render.
  const now = useRef({})
  now.current = { sel, clip, rowCount, colCount, valueOf, canEdit, onApply, onDenied, onUndo, onRedo }

  const range = rangeOf(sel)
  const setEditing = v => { editingRef.current = v; setEditingState(v) }
  const inBounds = (r, c) => r >= 0 && r < now.current.rowCount && c >= 0 && c < now.current.colCount
  const valuesOf = rg => {
    const out = []
    for (let r = rg.r1; r <= rg.r2; r++) {
      const row = []
      for (let c = rg.c1; c <= rg.c2; c++) row.push(now.current.valueOf(r, c))
      out.push(row)
    }
    return out
  }

  useEffect(() => {
    const up = () => {
      dragging.current = false
      if (fillRef.current) finishFill()
    }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep the hidden textarea holding (and having selected) exactly what a copy right now
  // should produce, so the browser's own Ctrl+C always has something to copy.
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta || !active || editing) return
    ta.value = toTSV(valuesOf(range))
    ta.focus({ preventScroll: true })
    ta.select()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, editing, sel.r, sel.c, sel.r2, sel.c2, rowCount, colCount])

  // The cells now mean something else: forget what was copied, drop an edit in progress, and keep the selection inside the grid.
  useEffect(() => {
    setClip(null)
    setEditing(null)
    setSel(s => {
      const last = Math.max(0, rowCount - 1)
      return { r: Math.min(s.r, last), c: s.c, r2: Math.min(s.r2, last), c2: s.c2 }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, rowCount])

  // After the keyboard (or a paste, fill or undo) moves the selection, keep its active cell on screen.
  useEffect(() => {
    if (!needScroll.current) return
    needScroll.current = false
    document.querySelector(`[data-cell="${sel.r2}-${sel.c2}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [sel])

  /** Hands changes to the caller, minus any in rows that can't be edited. */
  function commit(changes) {
    const { canEdit: ok, onApply: apply, onDenied: denied } = now.current
    const allowed = changes.filter(ch => ok(ch.r))
    if (allowed.length) apply(allowed)
    else if (changes.length) denied?.()
  }

  function select(r, c, extend) {
    if (!inBounds(r, c)) return
    if (editingRef.current) commitEdit(0, 0, { refocus: false }) // clicking another cell keeps what was typed, like Excel
    setActive(true)
    setEditing(null)
    setSel(s => (extend ? { ...s, r2: r, c2: c } : { r, c, r2: r, c2: c }))
    textareaRef.current?.focus({ preventScroll: true })
  }

  function beginDrag(r, c) { dragging.current = true; select(r, c, false) }

  function dragOver(r, c) {
    if (fillRef.current) { fillRef.current = { ...fillRef.current, to: { r, c } }; setFill(fillRef.current) }
    else if (dragging.current) select(r, c, true)
  }

  function moveTo(key, extend, ctrl) {
    setEditing(null)
    needScroll.current = true
    setSel(s => {
      const to = moveTarget({ r: s.r2, c: s.c2 }, key, { ctrl, rowCount: now.current.rowCount, colCount: now.current.colCount })
      return extend ? { ...s, r2: to.r, c2: to.c } : { r: to.r, c: to.c, r2: to.r, c2: to.c }
    })
  }

  /** Select whole blocks of cells — the cells given as [row, column] pairs (after an undo, say). */
  function selectCells(cells) {
    if (!cells.length) return
    setActive(true)
    setEditing(null)
    needScroll.current = true
    setSel(selectionOf(boundingRange(cells)))
  }

  /** seed null keeps what's already there (F2, double-click); a string replaces it (typing over it). */
  function startEdit(r, c, seed) {
    if (!inBounds(r, c)) return
    if (!now.current.canEdit(r)) return now.current.onDenied?.()
    setActive(true)
    setClip(null)
    setEditing({ r, c, text: seed === null ? now.current.valueOf(r, c) : seed, typed: seed !== null })
  }

  function commitEdit(dr = 0, dc = 0, { refocus = true, fillSelection = false } = {}) {
    const e = editingRef.current
    if (!e) return
    setEditing(null)
    const text = e.text.trim()
    if (fillSelection) commit(fillAllPlan(rangeOf(now.current.sel), text))
    else if (text !== now.current.valueOf(e.r, e.c)) commit([{ r: e.r, c: e.c, location: text }])
    if (dr || dc) moveTo(dr > 0 ? 'ArrowDown' : dr < 0 ? 'ArrowUp' : dc > 0 ? 'ArrowRight' : 'ArrowLeft', false, false)
    else if (refocus) textareaRef.current?.focus({ preventScroll: true })
  }

  function cancelEdit() {
    setEditing(null)
    textareaRef.current?.focus({ preventScroll: true })
  }

  function clearSelection() {
    setClip(null)
    const rg = rangeOf(now.current.sel)
    const changes = []
    for (let r = rg.r1; r <= rg.r2; r++) for (let c = rg.c1; c <= rg.c2; c++) if (now.current.valueOf(r, c)) changes.push({ r, c, location: '' })
    commit(changes)
  }

  function selectAll() {
    setActive(true)
    setSel({ r: 0, c: 0, r2: now.current.rowCount - 1, c2: now.current.colCount - 1 })
  }

  function fillDown() {
    const changes = fillDownPlan(now.current.valueOf, rangeOf(now.current.sel))
    if (!changes.length) return
    setClip(null)
    commit(changes)
  }

  // ── fill handle ──

  function startFill(e) {
    e.preventDefault()
    e.stopPropagation()
    const src = rangeOf(now.current.sel)
    fillRef.current = { src, to: { r: src.r2, c: src.c2 } }
    setFill(fillRef.current)
    dragging.current = false
  }

  function finishFill() {
    const f = fillRef.current
    fillRef.current = null
    setFill(null)
    if (!f) return
    const plan = fillPlan(now.current.valueOf, f.src, f.to, now.current.rowCount, now.current.colCount)
    if (!plan) return
    setClip(null)
    commit(plan.changes)
    needScroll.current = true
    setSel(selectionOf(plan.select))
  }

  // ── clipboard ──

  function copyOrCut(e, cut) {
    if (editingRef.current) return
    const rg = rangeOf(now.current.sel)
    const text = toTSV(valuesOf(rg))
    e.clipboardData.setData('text/plain', text)
    e.preventDefault()
    setClip({ ...rg, text, cut })
  }

  function handlePaste(e) {
    if (editingRef.current) return
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    if (!text) return
    const plan = pastePlan(fromTSV(text), rangeOf(now.current.sel), now.current.rowCount, now.current.colCount)
    const changes = [...plan.changes]
    const cutFrom = now.current.clip?.cut && now.current.clip.text === text ? now.current.clip : null
    if (cutFrom) {
      // A cut moves: once it lands, the cells it came from are emptied (unless something was pasted onto them).
      const target = new Set(plan.changes.map(ch => `${ch.r},${ch.c}`))
      for (let r = cutFrom.r1; r <= cutFrom.r2; r++) {
        for (let c = cutFrom.c1; c <= cutFrom.c2; c++) if (!target.has(`${r},${c}`) && now.current.valueOf(r, c)) changes.push({ r, c, location: '' })
      }
      setClip(null)
    }
    commit(changes)
    needScroll.current = true
    setSel(selectionOf(plan.select))
  }

  // ── keyboard ──

  function handleKeyDown(e) {
    const { key, shiftKey, ctrlKey, metaKey } = e
    if (ctrlKey || metaKey) {
      const k = key.toLowerCase()
      if (k === 'a') { e.preventDefault(); selectAll() }
      else if (k === 'z' && !shiftKey) { e.preventDefault(); now.current.onUndo?.() }
      else if (k === 'y' || (k === 'z' && shiftKey)) { e.preventDefault(); now.current.onRedo?.() }
      else if (k === 'd') { e.preventDefault(); fillDown() }
      else if (key === ' ') { e.preventDefault(); setSel(s => ({ r: 0, c: s.c2, r2: now.current.rowCount - 1, c2: s.c2 })) }
      else if (MOVE_KEYS.has(key)) { e.preventDefault(); moveTo(key, shiftKey, true) }
      return // C, X and V reach the copy, cut and paste handlers untouched
    }
    if (key === ' ' && shiftKey) { e.preventDefault(); setSel(s => ({ r: s.r2, c: 0, r2: s.r2, c2: now.current.colCount - 1 })) }
    else if (MOVE_KEYS.has(key)) { e.preventDefault(); moveTo(key, shiftKey, false) }
    else if (key === 'Tab') { e.preventDefault(); moveTo(shiftKey ? 'ArrowLeft' : 'ArrowRight', false, false) }
    else if (key === 'Enter' || key === 'F2') { e.preventDefault(); startEdit(now.current.sel.r2, now.current.sel.c2, null) }
    else if (key === 'Delete' || key === 'Backspace') { e.preventDefault(); clearSelection() }
    else if (key === 'Escape') { setClip(null) }
    else if (key.length === 1) { e.preventDefault(); startEdit(now.current.sel.r2, now.current.sel.c2, key) }
  }

  // ── what the page draws ──

  const preview = fill ? fillPlan(valueOf, fill.src, fill.to, rowCount, colCount) : null

  return {
    editing,
    isSelected: (r, c) => r >= range.r1 && r <= range.r2 && c >= range.c1 && c <= range.c2,
    isAnchor: (r, c) => r === sel.r2 && c === sel.c2,
    /** The fill handle sits on the bottom-right cell of the selection. */
    isHandle: (r, c) => active && !editing && !fill && r === range.r2 && c === range.c2,
    /** A copied or cut cell is outlined — a dashed line along the edges of the whole block. */
    clipEdges: (r, c) => {
      if (!clip || r < clip.r1 || r > clip.r2 || c < clip.c1 || c > clip.c2) return ''
      return ['wk-cell-clip', r === clip.r1 && 'wk-clip-t', c === clip.c2 && 'wk-clip-r', r === clip.r2 && 'wk-clip-b', c === clip.c1 && 'wk-clip-l'].filter(Boolean).join(' ')
    },
    /** Cells a fill in progress would fill (not the ones it copies from). */
    isFillPreview: (r, c) => !!preview
      && r >= preview.select.r1 && r <= preview.select.r2 && c >= preview.select.c1 && c <= preview.select.c2
      && !(r >= fill.src.r1 && r <= fill.src.r2 && c >= fill.src.c1 && c <= fill.src.c2),
    selectCells,
    fillHandleProps: { onMouseDown: startFill },
    cellHandlers: (r, c) => ({
      'data-cell': `${r}-${c}`,
      onMouseDown: e => {
        if (e.target.closest?.('.wk-fill-handle')) return // the handle has its own
        e.preventDefault()
        // Shift-click extends from the anchor, like Excel; a plain click
        // starts a fresh drag-selectable range.
        if (e.shiftKey) select(r, c, true)
        else beginDrag(r, c)
      },
      onMouseEnter: () => dragOver(r, c),
      onDoubleClick: () => { select(r, c, false); startEdit(r, c, null) },
    }),
    editingInputProps: editing && {
      value: editing.text,
      onChange: e => setEditing({ ...editingRef.current, text: e.target.value }),
      onKeyDown: e => {
        e.stopPropagation()
        const { key, shiftKey, ctrlKey, metaKey } = e
        if (key === 'Enter') {
          e.preventDefault()
          if (ctrlKey || metaKey) commitEdit(0, 0, { fillSelection: true })
          else commitEdit(shiftKey ? -1 : 1, 0)
        } else if (key === 'Tab') { e.preventDefault(); commitEdit(0, shiftKey ? -1 : 1) }
        else if (key === 'Escape') { e.preventDefault(); cancelEdit() }
        else if (key === 'F2') { e.preventDefault(); setEditing({ ...editingRef.current, typed: false }) }
        else if (editingRef.current?.typed && ARROW_STEP[key]) { e.preventDefault(); commitEdit(...ARROW_STEP[key]) } // typed straight in: arrows commit and move, like Excel
      },
      // Clicking into another box (the search, say) keeps the edit without stealing focus back.
      onBlur: e => commitEdit(0, 0, { refocus: !e.relatedTarget }),
      autoFocus: true,
    },
    catcherProps: {
      ref: textareaRef,
      className: 'wk-grid-catcher',
      defaultValue: '',
      onKeyDown: handleKeyDown,
      onCopy: e => copyOrCut(e, false),
      onCut: e => copyOrCut(e, true),
      onPaste: handlePaste,
      onFocus: e => { setActive(true); e.target.select() },
      readOnly: false,
      'aria-hidden': true,
      tabIndex: -1,
    },
  }
}
