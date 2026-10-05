// Run with `npm test`. The pure logic behind Team week's Excel-style grid: clipboard text, paste, fill and movement.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boundingRange, fillAllPlan, fillDownPlan, fillPlan, fromTSV, moveTarget, pastePlan, rangeOf, selectionOf, toTSV } from '../src/utils/gridOps.js'

/** A grid of cells as a lookup, the way the page reads them. */
const grid = rows => (r, c) => rows[r]?.[c] ?? ''
const at = (changes, r, c) => changes.find(ch => ch.r === r && ch.c === c)?.location

// ── clipboard text ────────────────────────────────────────────────────────

test('cells go on the clipboard with tabs between columns and newlines between rows', () => {
  assert.equal(toTSV([['Cass Office', 'Hamilton'], ['', 'Leave']]), 'Cass Office\tHamilton\n\tLeave')
  assert.equal(toTSV([['A']]), 'A')
})

test('text from Excel is read back into rows, with the one empty row it ends with dropped', () => {
  assert.deepEqual(fromTSV('A\tB\nC\tD\n'), [['A', 'B'], ['C', 'D']])
  assert.deepEqual(fromTSV('A\tB\r\nC\tD\r\n'), [['A', 'B'], ['C', 'D']])
  assert.deepEqual(fromTSV('Hamilton'), [['Hamilton']])
  assert.deepEqual(fromTSV(''), [['']])
})

test('empty cells at the ends of rows, and an empty last row, are kept', () => {
  assert.deepEqual(fromTSV('A\t\tC\n\t\t\n'), [['A', '', 'C'], ['', '', '']])
  assert.deepEqual(fromTSV('A\n\n'), [['A'], ['']])
})

test('a cell with a line break, tab or quote in it survives the trip, quoted the way Excel does', () => {
  const rows = [['two\nlines', 'a\tb'], ['say "hi"', 'plain']]
  const text = toTSV(rows)
  assert.equal(text, '"two\nlines"\t"a\tb"\n"say ""hi"""\tplain')
  assert.deepEqual(fromTSV(text), rows)
  assert.deepEqual(fromTSV('"a ""quoted"" word"\tb'), [['a "quoted" word', 'b']])
})

// ── selections ────────────────────────────────────────────────────────────

test('a selection is read as an ordered range whichever way it was dragged', () => {
  assert.deepEqual(rangeOf({ r: 5, c: 3, r2: 2, c2: 1 }), { r1: 2, c1: 1, r2: 5, c2: 3 })
  assert.deepEqual(selectionOf({ r1: 2, c1: 1, r2: 5, c2: 3 }), { r: 2, c: 1, r2: 5, c2: 3 })
  assert.deepEqual(boundingRange([[4, 2], [1, 3], [2, 0]]), { r1: 1, c1: 0, r2: 4, c2: 3 })
})

// ── pasting ───────────────────────────────────────────────────────────────

test('one copied cell fills the whole selection', () => {
  const plan = pastePlan([['Cass Office']], { r1: 1, c1: 0, r2: 2, c2: 1 }, 10, 5)
  assert.equal(plan.changes.length, 4)
  assert.ok(plan.changes.every(ch => ch.location === 'Cass Office'))
  assert.deepEqual(plan.select, { r1: 1, c1: 0, r2: 2, c2: 1 })
})

test('a block starts at the top-left of the selection', () => {
  const plan = pastePlan([['A', 'B', 'C'], ['D', 'E', 'F']], { r1: 3, c1: 1, r2: 3, c2: 1 }, 10, 5)
  assert.deepEqual(plan.changes.map(ch => [ch.r, ch.c, ch.location]), [[3, 1, 'A'], [3, 2, 'B'], [3, 3, 'C'], [4, 1, 'D'], [4, 2, 'E'], [4, 3, 'F']])
  assert.deepEqual(plan.select, { r1: 3, c1: 1, r2: 4, c2: 3 })
})

test('a block repeats across a selection that is a whole number of blocks, but not otherwise', () => {
  const tiled = pastePlan([['A', 'B']], { r1: 0, c1: 0, r2: 2, c2: 3 }, 10, 5) // 3 rows × 4 columns: B fits twice across, three times down
  assert.equal(tiled.changes.length, 12)
  assert.deepEqual([at(tiled.changes, 0, 0), at(tiled.changes, 0, 1), at(tiled.changes, 0, 2), at(tiled.changes, 0, 3), at(tiled.changes, 2, 3)], ['A', 'B', 'A', 'B', 'B'])
  const notWhole = pastePlan([['A', 'B']], { r1: 0, c1: 0, r2: 0, c2: 2 }, 10, 5) // 3 columns is not a multiple of 2
  assert.equal(notWhole.changes.length, 2)
})

test('whatever runs past the edge of the grid is dropped', () => {
  const plan = pastePlan([['A', 'B', 'C'], ['D', 'E', 'F'], ['G', 'H', 'I']], { r1: 3, c1: 3, r2: 3, c2: 3 }, 5, 5)
  assert.deepEqual(plan.changes.map(ch => [ch.r, ch.c, ch.location]), [[3, 3, 'A'], [3, 4, 'B'], [4, 3, 'D'], [4, 4, 'E']])
  assert.deepEqual(plan.select, { r1: 3, c1: 3, r2: 4, c2: 4 })
})

test('pasted text is tidied, and a short row leaves the rest of its cells empty', () => {
  const plan = pastePlan([['  A  ', 'B'], ['C']], { r1: 0, c1: 0, r2: 0, c2: 0 }, 5, 5)
  assert.deepEqual(plan.changes.map(ch => [ch.r, ch.c, ch.location]), [[0, 0, 'A'], [0, 1, 'B'], [1, 0, 'C'], [1, 1, '']])
})

// ── filling ───────────────────────────────────────────────────────────────

const days = grid([['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], ['a', 'b', 'c', 'd', 'e'], ['f', 'g', 'h', 'i', 'j'], ['k', 'l', 'm', 'n', 'o'], ['p', 'q', 'r', 's', 't']])

test('dragging the fill handle down repeats the selected cells', () => {
  const plan = fillPlan(days, { r1: 1, c1: 0, r2: 2, c2: 0 }, { r: 4, c: 0 }, 5, 5) // two cells (a, f) dragged down two rows
  assert.deepEqual(plan.changes.map(ch => [ch.r, ch.c, ch.location]), [[3, 0, 'a'], [4, 0, 'f']])
  assert.deepEqual(plan.select, { r1: 1, c1: 0, r2: 4, c2: 0 })
})

test('dragging right fills along the row', () => {
  const plan = fillPlan(days, { r1: 1, c1: 0, r2: 1, c2: 0 }, { r: 1, c: 4 }, 5, 5)
  assert.deepEqual(plan.changes.map(ch => [ch.r, ch.c, ch.location]), [[1, 1, 'a'], [1, 2, 'a'], [1, 3, 'a'], [1, 4, 'a']])
  assert.deepEqual(plan.select, { r1: 1, c1: 0, r2: 1, c2: 4 })
})

test('filling up or left runs the pattern backwards', () => {
  const up = fillPlan(days, { r1: 3, c1: 0, r2: 4, c2: 0 }, { r: 0, c: 0 }, 5, 5) // k, p dragged up three rows
  assert.deepEqual(up.changes.map(ch => [ch.r, ch.c, ch.location]), [[2, 0, 'p'], [1, 0, 'k'], [0, 0, 'p']])
  assert.deepEqual(up.select, { r1: 0, c1: 0, r2: 4, c2: 0 })
  const left = fillPlan(days, { r1: 1, c1: 3, r2: 1, c2: 4 }, { r: 1, c: 0 }, 5, 5)
  assert.deepEqual(left.changes.map(ch => [ch.r, ch.c, ch.location]), [[1, 2, 'e'], [1, 1, 'd'], [1, 0, 'e']])
})

test('a fill follows whichever direction was dragged further, covers every selected column, and stops at the grid', () => {
  const plan = fillPlan(days, { r1: 1, c1: 1, r2: 1, c2: 2 }, { r: 4, c: 3 }, 5, 5) // down 3, right 1: down wins
  assert.equal(plan.changes.length, 6)
  assert.deepEqual([at(plan.changes, 2, 1), at(plan.changes, 2, 2), at(plan.changes, 4, 2)], ['b', 'c', 'c'])
  assert.equal(fillPlan(days, { r1: 3, c1: 0, r2: 4, c2: 0 }, { r: 9, c: 0 }, 5, 5), null) // already at the bottom
  assert.equal(fillPlan(days, { r1: 1, c1: 0, r2: 2, c2: 0 }, { r: 2, c: 0 }, 5, 5), null) // not dragged
})

test('Ctrl+D copies the top row of the selection down through it, or the row above into a single row', () => {
  const down = fillDownPlan(days, { r1: 1, c1: 0, r2: 3, c2: 1 })
  assert.deepEqual(down.map(ch => [ch.r, ch.c, ch.location]), [[2, 0, 'a'], [2, 1, 'b'], [3, 0, 'a'], [3, 1, 'b']])
  const single = fillDownPlan(days, { r1: 2, c1: 1, r2: 2, c2: 2 })
  assert.deepEqual(single.map(ch => [ch.r, ch.c, ch.location]), [[2, 1, 'b'], [2, 2, 'c']])
  assert.deepEqual(fillDownPlan(days, { r1: 0, c1: 0, r2: 0, c2: 2 }), []) // nothing above the first row
})

test('Ctrl+Enter puts one text in every cell of the selection', () => {
  const changes = fillAllPlan({ r1: 1, c1: 1, r2: 2, c2: 3 }, 'Annual Leave')
  assert.equal(changes.length, 6)
  assert.ok(changes.every(ch => ch.location === 'Annual Leave'))
})

// ── moving ────────────────────────────────────────────────────────────────

test('the arrow keys move one cell and stop at the edges; with Ctrl they run to the edge', () => {
  const o = { rowCount: 30, colCount: 5 }
  assert.deepEqual(moveTarget({ r: 3, c: 2 }, 'ArrowDown', o), { r: 4, c: 2 })
  assert.deepEqual(moveTarget({ r: 0, c: 0 }, 'ArrowUp', o), { r: 0, c: 0 })
  assert.deepEqual(moveTarget({ r: 29, c: 4 }, 'ArrowRight', o), { r: 29, c: 4 })
  assert.deepEqual(moveTarget({ r: 3, c: 2 }, 'ArrowDown', { ...o, ctrl: true }), { r: 29, c: 2 })
  assert.deepEqual(moveTarget({ r: 3, c: 2 }, 'ArrowLeft', { ...o, ctrl: true }), { r: 3, c: 0 })
})

test('Home, End, PageUp and PageDown', () => {
  const o = { rowCount: 30, colCount: 5 }
  assert.deepEqual(moveTarget({ r: 7, c: 2 }, 'Home', o), { r: 7, c: 0 })
  assert.deepEqual(moveTarget({ r: 7, c: 2 }, 'End', o), { r: 7, c: 4 })
  assert.deepEqual(moveTarget({ r: 7, c: 2 }, 'Home', { ...o, ctrl: true }), { r: 0, c: 0 })
  assert.deepEqual(moveTarget({ r: 7, c: 2 }, 'End', { ...o, ctrl: true }), { r: 29, c: 4 })
  assert.deepEqual(moveTarget({ r: 7, c: 2 }, 'PageDown', o), { r: 17, c: 2 })
  assert.deepEqual(moveTarget({ r: 25, c: 2 }, 'PageDown', o), { r: 29, c: 2 })
  assert.deepEqual(moveTarget({ r: 4, c: 2 }, 'PageUp', o), { r: 0, c: 2 })
})
