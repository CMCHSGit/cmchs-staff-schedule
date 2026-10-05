/**
 * The pure parts of Team week's Excel-style grid — turning cells into clipboard text and back, and working out
 * what a paste or a fill changes — kept apart from the hook that handles the mouse and keyboard so they can be
 * tested on their own. A "range" is { r1, c1, r2, c2 } (rows are people, columns are weekdays), a "change" is
 * { r, c, location }.
 */

// ── the clipboard: tabs between columns, newlines between rows, like Excel ──

/** A cell that has a tab, a newline or a quote in it is wrapped in quotes (quotes doubled), the way Excel does. */
const quoteField = text => (/[\t\n\r"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text)

/** Rows of cell text → clipboard text. */
export const toTSV = grid => grid.map(row => row.map(quoteField).join('\t')).join('\n')

/**
 * Clipboard text → rows of cell text. Understands the quoting Excel uses for a cell with a line break in it, and
 * drops the one empty row Excel leaves at the end of what it copies.
 */
export function fromTSV(text) {
  const s = String(text ?? '').replace(/\r\n?/g, '\n')
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  let fieldStart = true
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quoted) {
      if (ch !== '"') field += ch
      else if (s[i + 1] === '"') { field += '"'; i++ }
      else quoted = false
    } else if (ch === '"' && fieldStart) {
      quoted = true
      fieldStart = false
    } else if (ch === '\t') {
      row.push(field); field = ''; fieldStart = true
    } else if (ch === '\n') {
      row.push(field); rows.push(row); row = []; field = ''; fieldStart = true
    } else {
      field += ch
      fieldStart = false
    }
  }
  row.push(field)
  rows.push(row)
  if (rows.length > 1 && rows.at(-1).length === 1 && rows.at(-1)[0] === '') rows.pop()
  return rows
}

// ── selections ──

/** A selection { r, c, r2, c2 } (where it started, where it ends) as an ordered range. */
export const rangeOf = sel => ({
  r1: Math.min(sel.r, sel.r2), c1: Math.min(sel.c, sel.c2),
  r2: Math.max(sel.r, sel.r2), c2: Math.max(sel.c, sel.c2),
})

/** A range as a selection that starts at its top-left. */
export const selectionOf = range => ({ r: range.r1, c: range.c1, r2: range.r2, c2: range.c2 })

/** The range that covers every [row, column] pair given. */
export function boundingRange(cells) {
  const rs = cells.map(([r]) => r)
  const cs = cells.map(([, c]) => c)
  return { r1: Math.min(...rs), c1: Math.min(...cs), r2: Math.max(...rs), c2: Math.max(...cs) }
}

// ── pasting ──

/**
 * What pasting `block` (rows of text) into a grid does, given the selected `range`: { changes, select }.
 * One copied cell fills the whole selection, like Excel. A bigger block starts at the selection's top-left,
 * and repeats to fill the selection when that is a whole number of blocks high or wide. Whatever would run
 * past the edge of the grid is dropped; `select` is the area that was pasted into.
 */
export function pastePlan(block, range, rowCount, colCount) {
  const bRows = block.length
  const bCols = Math.max(1, ...block.map(row => row.length))
  const selRows = range.r2 - range.r1 + 1
  const selCols = range.c2 - range.c1 + 1
  const single = bRows === 1 && bCols === 1
  const rows = single || (selRows > bRows && selRows % bRows === 0) ? selRows : bRows
  const cols = single || (selCols > bCols && selCols % bCols === 0) ? selCols : bCols
  const changes = []
  let lastR = range.r1
  let lastC = range.c1
  for (let dr = 0; dr < rows; dr++) {
    const r = range.r1 + dr
    if (r >= rowCount) break
    const source = block[dr % bRows]
    for (let dc = 0; dc < cols; dc++) {
      const c = range.c1 + dc
      if (c >= colCount) break
      changes.push({ r, c, location: String(source[dc % bCols] ?? '').trim() })
      lastR = Math.max(lastR, r)
      lastC = Math.max(lastC, c)
    }
  }
  return { changes, select: { r1: range.r1, c1: range.c1, r2: lastR, c2: lastC } }
}

// ── filling ──

/**
 * Dragging the fill handle from the selected `source` range to the cell `to`: { changes, select } or null.
 * It fills in whichever direction was dragged furthest, repeating what is in the source (a column of two
 * cells fills A, B, A, B…; filling up or left runs the pattern backwards, as Excel does).
 */
export function fillPlan(valueOf, source, to, rowCount, colCount) {
  const rows = source.r2 - source.r1 + 1
  const cols = source.c2 - source.c1 + 1
  const dr = to.r > source.r2 ? to.r - source.r2 : to.r < source.r1 ? to.r - source.r1 : 0
  const dc = to.c > source.c2 ? to.c - source.c2 : to.c < source.c1 ? to.c - source.c1 : 0
  if (!dr && !dc) return null
  const changes = []
  if (Math.abs(dr) >= Math.abs(dc)) {
    const room = dr > 0 ? rowCount - 1 - source.r2 : source.r1
    const n = Math.min(Math.abs(dr), room)
    for (let k = 1; k <= n; k++) {
      const r = dr > 0 ? source.r2 + k : source.r1 - k
      const from = dr > 0 ? source.r1 + ((k - 1) % rows) : source.r2 - ((k - 1) % rows)
      for (let c = source.c1; c <= source.c2; c++) changes.push({ r, c, location: valueOf(from, c) })
    }
    if (!n) return null
    return { changes, select: dr > 0 ? { ...source, r2: source.r2 + n } : { ...source, r1: source.r1 - n } }
  }
  const room = dc > 0 ? colCount - 1 - source.c2 : source.c1
  const n = Math.min(Math.abs(dc), room)
  for (let k = 1; k <= n; k++) {
    const c = dc > 0 ? source.c2 + k : source.c1 - k
    const from = dc > 0 ? source.c1 + ((k - 1) % cols) : source.c2 - ((k - 1) % cols)
    for (let r = source.r1; r <= source.r2; r++) changes.push({ r, c, location: valueOf(r, from) })
  }
  if (!n) return null
  return { changes, select: dc > 0 ? { ...source, c2: source.c2 + n } : { ...source, c1: source.c1 - n } }
}

/**
 * Ctrl+D: the first row of the selection is copied down through the rest of it; with a single row
 * selected, the row above is copied into it.
 */
export function fillDownPlan(valueOf, range) {
  const changes = []
  if (range.r2 > range.r1) {
    for (let r = range.r1 + 1; r <= range.r2; r++) for (let c = range.c1; c <= range.c2; c++) changes.push({ r, c, location: valueOf(range.r1, c) })
  } else if (range.r1 > 0) {
    for (let c = range.c1; c <= range.c2; c++) changes.push({ r: range.r1, c, location: valueOf(range.r1 - 1, c) })
  }
  return changes
}

/** Typing into a cell and pressing Ctrl+Enter puts the same text in every cell of the selection. */
export function fillAllPlan(range, location) {
  const changes = []
  for (let r = range.r1; r <= range.r2; r++) for (let c = range.c1; c <= range.c2; c++) changes.push({ r, c, location })
  return changes
}

// ── moving ──

const PAGE = 10

/**
 * Where an arrow, Home, End, PageUp or PageDown key takes the active cell { r, c }. With Ctrl the arrows and
 * Home/End run to the edge of the grid instead of one step.
 */
export function moveTarget({ r, c }, key, { ctrl = false, rowCount, colCount }) {
  const lastR = rowCount - 1
  const lastC = colCount - 1
  switch (key) {
    case 'ArrowUp': return { r: ctrl ? 0 : Math.max(0, r - 1), c }
    case 'ArrowDown': return { r: ctrl ? lastR : Math.min(lastR, r + 1), c }
    case 'ArrowLeft': return { r, c: ctrl ? 0 : Math.max(0, c - 1) }
    case 'ArrowRight': return { r, c: ctrl ? lastC : Math.min(lastC, c + 1) }
    case 'Home': return { r: ctrl ? 0 : r, c: 0 }
    case 'End': return { r: ctrl ? lastR : r, c: lastC }
    case 'PageUp': return { r: Math.max(0, r - PAGE), c }
    case 'PageDown': return { r: Math.min(lastR, r + PAGE), c }
    default: return { r, c }
  }
}
