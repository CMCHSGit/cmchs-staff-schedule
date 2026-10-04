// Run with `npm test`. Covers the Excel import's pure logic: reading the workbook, matching names to
// people, and merging safely. Every name here is made up — never put real staff data in this repo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { indexWorkbook, readPeople, combineHalves } from '../src/utils/excelSchedule.js'
import { matchPeople, buildMapping, excelPeople, mergeText, planImport, nameKey, placeholderId } from '../src/utils/excelPlan.js'

// ── reading the workbook ──────────────────────────────────────────────────

const utc = iso => new Date(`${iso}T00:00:00Z`)

/** A small workbook in the real layout: team labels merged down the side, AM/PM rows merged when equal. */
function buildWorkbook() {
  const wb = new ExcelJS.Workbook()

  const ws = wb.addWorksheet('05-Oct')
  ws.getCell('B1').value = 'Week starting:'; ws.getCell('C1').value = utc('2026-10-05'); ws.getCell('D1').value = utc('2026-10-05')
  ws.getCell('A2').value = 'Engineers'; ws.mergeCells('A2:A8')
  const rows = [
    [3, 'Alex', ['Cass Office', 'Tauranga', '', 'Cass Office', 'Leave'], 'Back 12th'],
    [5, 'Blair - OnCall', ['Cass Office / Customer Calls', 'Hamilton', 'Hamilton', 'Remote Support', 'Remote Support'], ''],
    [7, 'Casey', ['Waikato', 'Cass Office', 'Cass Office', 'Cass Office', 'Cass Office'], ''],
  ]
  for (const [r, name, days, comment] of rows) {
    ws.getCell(r, 2).value = name; ws.mergeCells(r, 2, r + 1, 2)
    ws.getCell(r, 3).value = 'AM'; ws.getCell(r + 1, 3).value = 'PM'
    days.forEach((d, i) => { if (d) ws.getCell(r, 4 + i).value = d; ws.mergeCells(r, 4 + i, r + 1, 4 + i) })
    if (comment) ws.getCell(r, 9).value = comment
  }
  // Casey's Monday is split: AM and PM differ, so they're not merged
  ws.unMergeCells(7, 4, 8, 4); ws.getCell(7, 4).value = 'Waikato'; ws.getCell(8, 4).value = 'Cass Office'

  const old = wb.addWorksheet('14-Jul-25') // older layout: no team column
  old.getCell('A1').value = 'Week starting:'; old.getCell('B1').value = utc('2025-07-14'); old.getCell('C1').value = utc('2025-07-14')
  old.getCell('A3').value = 'Alex'; old.getCell('B3').value = 'AM'; old.getCell('B4').value = 'PM'
  old.getCell('C3').value = 'Starship'; old.mergeCells('C3:C4')

  wb.addWorksheet("Template (don't use)").getCell('A1').value = 'template'
  wb.addWorksheet('Notes').getCell('A1').value = 'not a schedule'
  const bad = wb.addWorksheet('wrong date') // header says a Tuesday
  bad.getCell('B1').value = 'Week starting:'; bad.getCell('C1').value = utc('2026-10-06'); bad.getCell('D1').value = utc('2026-10-06')
  bad.getCell('B3').value = 'Zed'; bad.getCell('C3').value = 'AM'
  return wb
}

test('reader: finds weeks by the header date, in both layouts, and says what it skipped', () => {
  const { weeks, skipped } = indexWorkbook(buildWorkbook())
  assert.deepEqual([...weeks.keys()].sort(), ['2025-07-14', '2026-10-05'])
  assert.equal(weeks.get('2026-10-05').layout.amCol, 3)
  assert.equal(weeks.get('2025-07-14').layout.amCol, 2)
  assert.deepEqual(skipped.map(s => s.sheet).sort(), ['Notes', 'wrong date'])
})

test('reader: people, team, days, comment, on-call and split days', () => {
  const { weeks } = indexWorkbook(buildWorkbook())
  const { ws, layout } = weeks.get('2026-10-05')
  const people = readPeople(ws, layout)
  assert.deepEqual(people.map(p => p.name), ['Alex', 'Blair', 'Casey'])
  assert.deepEqual(people.map(p => p.team), ['Engineers', 'Engineers', 'Engineers'])
  assert.deepEqual(people[0].days, ['Cass Office', 'Tauranga', '', 'Cass Office', 'Leave'])
  assert.equal(people[0].comment, 'Back 12th')
  assert.deepEqual(people.map(p => p.onCall), [false, true, false])            // "Blair - OnCall"
  assert.equal(people[1].days[0], 'Cass Office / Customer Calls')
  assert.equal(people[2].days[0], 'Waikato / Cass Office')                     // AM ≠ PM → one entry
})

test('reader: the older layout has no team', () => {
  const { weeks } = indexWorkbook(buildWorkbook())
  const { ws, layout } = weeks.get('2025-07-14')
  assert.deepEqual(readPeople(ws, layout).map(p => [p.name, p.team, p.days[0]]), [['Alex', '', 'Starship']])
})

test('reader: AM/PM halves combine without repeating', () => {
  assert.equal(combineHalves('Cass Office', 'cass office'), 'Cass Office')
  assert.equal(combineHalves('', 'Hamilton'), 'Hamilton')
  assert.equal(combineHalves('Cass Office', 'Cass Office / Customer Calls'), 'Cass Office / Customer Calls')
})

// ── matching people ───────────────────────────────────────────────────────

const users = [
  { uid: 'u1', displayName: 'Alex Morgan', team: 'Engineers' },
  { uid: 'u2', displayName: 'Sam Reed', team: 'Application' },
  { uid: 'u3', displayName: 'Chang-Chien (Peter) Lin', team: 'Engineers' },
  { uid: 'u4', displayName: 'Jess Chalk', team: 'Sales' },
  { uid: 'u5', displayName: 'Jess Brown', team: 'Application', pending: true },
  { uid: 'u6', displayName: 'Sam Lee', team: 'Sales' },
  { uid: 'u7', displayName: 'Sam Park', team: 'Engineers' },
  { uid: 'u8', displayName: 'Robert Brown', team: 'Admin', excelName: 'Bobby' },
  { uid: 'u9', displayName: 'Taylor One', team: 'Sales' },
  { uid: 'u10', displayName: 'Taylor Two', team: 'Sales' },
  { uid: 'u11', displayName: 'Noor Teamless' },
]
const P = (name, team = '') => ({ key: nameKey(name), name, team })
const match = (people, us = users) => matchPeople(people, us)

test('match: a first name matches within the same team', () => assert.deepEqual(match([P('Alex', 'Engineers')]).get('alex'), { status: 'matched', uid: 'u1', how: 'first name' }))
test('match: a nickname counts as a first name', () => assert.equal(match([P('Peter', 'Engineers')]).get('peter').uid, 'u3'))
test('match: full names match first + last', () => assert.equal(match([P('Sam Reed', 'Application')]).get('sam reed').uid, 'u2'))
test('match: the same first name on another team is NOT mistaken for them', () => {
  assert.equal(match([P('Sam', 'Management')]).get('sam').status, 'none')
  assert.equal(match([P('Sam', 'Management'), P('Sam Reed', 'Application')]).get('sam').status, 'none')
})
test('match: two people sharing a first name resolve by full name', () => {
  const m = match([P('Jess Chalk', 'Sales'), P('Jess Brown', 'Application')])
  assert.equal(m.get('jess chalk').uid, 'u4'); assert.equal(m.get('jess brown').uid, 'u5')
})
test('match: first name + team picks the right Sam', () => assert.equal(match([P('Sam', 'Sales')]).get('sam').uid, 'u6'))
test('match: an admin-set Excel name wins', () => assert.deepEqual(match([P('Bobby', 'Admin')]).get('bobby'), { status: 'matched', uid: 'u8', how: 'Excel name' }))
test('match: two people who fit are ambiguous, never guessed', () => {
  const m = match([P('Taylor', 'Sales')]).get('taylor')
  assert.equal(m.status, 'ambiguous'); assert.deepEqual(m.candidates.sort(), ['u10', 'u9'])
})
test('match: someone with no team on file matches whichever team the Excel says', () => assert.equal(match([P('Noor', 'Sales')]).get('noor').uid, 'u11'))
test('match: unknown names are "none"', () => assert.equal(match([P('Casey', 'Engineers')]).get('casey').status, 'none'))
test('match: nobody is matched twice', () => {
  const m = match([P('Alex', 'Engineers'), P('Alex Morgan', 'Engineers')])
  assert.equal(m.get('alex morgan').uid, 'u1'); assert.equal(m.get('alex').status, 'none')
})
test('match: accents and case are ignored', () => assert.equal(match([P('ÁLEX', 'Engineers')]).get('alex').uid, 'u1'))
test('match: hyphens are ignored (Jo-ann = Joann)', () => assert.equal(match([P('Jo-ann', 'Sales')], [{ uid: 'j', displayName: 'Joann Fox', team: 'Sales' }]).get('jo-ann').uid, 'j'))

test('close names are suggestions to confirm, not matches', () => {
  const us = [{ uid: 'm', displayName: 'Michael Fox', team: 'Engineers' }, { uid: 'j', displayName: 'Jessica Reed', team: 'Sales' }, { uid: 'b', displayName: 'Benjamin Cole', team: 'Admin' }, { uid: 'a', displayName: 'Andrew Ng', team: 'Management' }]
  const m = matchPeople([P('Mike', 'Engineers'), P('Jess Reed', 'Sales'), P('Ben', 'Admin'), P('Andy', 'Management')], us)
  for (const [key, uid] of [['mike', 'm'], ['jess reed', 'j'], ['ben', 'b'], ['andy', 'a']]) {
    assert.deepEqual([m.get(key).status, m.get(key).candidates], ['maybe', [uid]], key)
  }
  // …and they're skipped (not added as a duplicate person) until the admin picks
  const people = [P('Mike', 'Engineers')]
  assert.equal(buildMapping(people, matchPeople(people, us), us).get('mike').kind, 'skip')
  assert.deepEqual(buildMapping(people, matchPeople(people, us), us, { overrides: { mike: 'm' } }).get('mike'), { kind: 'user', uid: 'm' })
})
test('close names need the same team, or the same surname when there is one', () => {
  const us = [{ uid: 'm', displayName: 'Michael Fox', team: 'Engineers' }, { uid: 'j', displayName: 'Jessica Park', team: 'Sales' }]
  assert.equal(matchPeople([P('Mike', 'Sales')], us).get('mike').status, 'none')              // different team
  assert.equal(matchPeople([P('Jess Reed', 'Sales')], us).get('jess reed').status, 'none')    // different surname
})
test('very short names are never treated as the start of a longer one', () => assert.equal(matchPeople([P('Al', 'Engineers')], users).get('al').status, 'none'))
test('a close name is not suggested for someone already matched exactly', () => {
  const us = [{ uid: 'm', displayName: 'Michael Fox', team: 'Engineers' }]
  const m = matchPeople([P('Michael', 'Engineers'), P('Mike', 'Engineers')], us)
  assert.equal(m.get('michael').uid, 'm'); assert.equal(m.get('mike').status, 'none')
})

test('excelPeople: once each, newest spelling/team winning, hints for old sheets', () => {
  const people = excelPeople(new Map([['2025-01-06', [{ name: 'Sam', team: '' }]], ['2026-01-05', [{ name: 'SAM', team: 'Sales' }, { name: 'New', team: '' }]]]), [{ name: 'New', team: 'Admin' }])
  assert.deepEqual(people.map(p => [p.name, p.team]), [['SAM', 'Sales'], ['New', 'Admin']])
})

test('mapping: matches → user, unknown → new person, unclear → skipped; admin choices respected', () => {
  const people = [P('Alex', 'Engineers'), P('Casey', 'Engineers'), P('Taylor', 'Sales')]
  const matching = match(people)
  const m = buildMapping(people, matching, users)
  assert.deepEqual(m.get('alex'), { kind: 'user', uid: 'u1' })
  assert.deepEqual(m.get('casey'), { kind: 'new', id: 'pending-casey', displayName: 'Casey', team: 'Engineers' })
  assert.deepEqual(m.get('taylor'), { kind: 'skip' })
  const o = buildMapping(people, matching, users, { overrides: { taylor: 'u9', casey: 'skip', alex: 'new' } })
  assert.deepEqual(o.get('taylor'), { kind: 'user', uid: 'u9' }); assert.equal(o.get('casey').kind, 'skip'); assert.equal(o.get('alex').kind, 'new')
  assert.equal(buildMapping(people, matching, users, { addNew: false }).get('casey').kind, 'skip')
})
test('mapping: people only in old weeks are not added as new, but are still matched', () => {
  const people = [P('Alex', 'Engineers'), P('Leaver', 'Sales')]
  const m = buildMapping(people, match(people), users, { currentKeys: new Set(['alex']) })
  assert.equal(m.get('alex').kind, 'user'); assert.equal(m.get('leaver').kind, 'skip')
  assert.equal(buildMapping(people, match(people), users, { currentKeys: new Set(), overrides: { leaver: 'new' } }).get('leaver').kind, 'new')
})
test('mapping: an existing placeholder is reused, never overwritten', () => {
  const us = [...users, { uid: 'pending-casey', displayName: 'Casey', team: 'Admin', pending: true }]
  const people = [P('Casey', 'Engineers')]
  assert.deepEqual(buildMapping(people, matchPeople(people, us), us).get('casey'), { kind: 'user', uid: 'pending-casey' })
})
test('placeholder ids match Admin → Add a person', () => assert.equal(placeholderId("Jo-ann  O'Neil"), 'pending-jo-ann-o-neil'))

// ── merging ───────────────────────────────────────────────────────────────

test('merge: an Excel blank never blanks the app', () => assert.deepEqual(mergeText('', 'Tauranga', 'Tauranga'), { value: 'Tauranga', kind: 'none' }))
test('merge: a blank app cell is filled', () => assert.deepEqual(mergeText('Hamilton', '', undefined), { value: 'Hamilton', kind: 'added' }))
test('merge: same (ignoring case/spacing) is untouched', () => assert.equal(mergeText('cass  office', 'Cass Office').kind, 'same'))
test('merge: app unchanged since last import → the Excel change flows in', () => assert.deepEqual(mergeText('Dunedin', 'Tauranga', 'Tauranga'), { value: 'Dunedin', kind: 'updated' }))
test('merge: Excel unchanged, app edited → the app is kept (not a conflict)', () => assert.deepEqual(mergeText('Tauranga', 'Waikato', 'Tauranga'), { value: 'Waikato', kind: 'kept' }))
test('merge: both changed → conflict, the app wins', () => assert.deepEqual(mergeText('Dunedin', 'Waikato', 'Tauranga'), { value: 'Waikato', kind: 'conflict' }))
test('merge: no history and they differ → conflict', () => assert.equal(mergeText('Dunedin', 'Waikato', undefined).kind, 'conflict'))
test('merge: "prefer Excel" settles conflicts in the Excel’s favour', () => assert.deepEqual(mergeText('Dunedin', 'Waikato', 'Tauranga', true), { value: 'Dunedin', kind: 'replaced' }))

// ── planning an import ────────────────────────────────────────────────────

const D = (...d) => d.concat(['', '', '', '', '']).slice(0, 5)
const week = people => new Map([['2026-10-05', people]])
const run = (over = {}) => {
  const people = over.people || [{ name: 'Alex', team: 'Engineers', onCall: false, days: D('Cass Office', 'Tauranga', 'Tauranga', 'Cass Office', 'Leave'), comment: 'Back 12th' }]
  const ppl = people.map(p => ({ key: nameKey(p.name), name: p.name, team: p.team }))
  const us = over.users || users
  return planImport({
    weeks: over.weeks || week(people), selected: over.selected || ['2026-10-05'],
    mapping: buildMapping(ppl, matchPeople(ppl, us), us, over.mapOpts), users: us,
    existing: over.existing || new Map(), existingOnCall: over.existingOnCall || new Map(), excelWins: over.excelWins,
  })
}
const apply = (plan, existing = new Map()) => { // pretend the writer ran
  const next = new Map(existing)
  for (const s of plan.schedules) next.set(s.id, { ...(next.get(s.id) || {}), days: s.days, comments: s.comments, excelBase: s.base })
  return next
}
const withDay = (existing, id, i, location) => { const doc = existing.get(id); doc.days = doc.days.map((d, n) => (n === i ? { ...d, location } : d)); return existing }

test('plan: a new week creates a doc with the Excel values and remembers them', () => {
  const plan = run()
  assert.equal(plan.schedules.length, 1)
  const s = plan.schedules[0]
  assert.equal(s.id, '2026-10-05_u1'); assert.equal(s.isNew, true)
  assert.deepEqual(s.days.map(d => d.location), ['Cass Office', 'Tauranga', 'Tauranga', 'Cass Office', 'Leave'])
  assert.equal(s.comments, 'Back 12th'); assert.deepEqual(s.base.days, ['Cass Office', 'Tauranga', 'Tauranga', 'Cass Office', 'Leave'])
  assert.equal(plan.stats.added, 5)
})
test('plan: running the same import twice changes nothing the second time', () => {
  const second = run({ existing: apply(run()) })
  assert.equal(second.schedules.length, 0); assert.equal(second.stats.same, 5)
})
test('plan: an Excel edit made later flows in when the app was untouched', () => {
  const plan = run({ existing: apply(run()), people: [{ name: 'Alex', team: 'Engineers', days: D('Cass Office', 'Dunedin', 'Tauranga', 'Cass Office', 'Leave'), comment: 'Back 12th' }] })
  assert.equal(plan.schedules[0].days[1].location, 'Dunedin'); assert.equal(plan.stats.updated, 1)
})
test('plan: an app edit made later is kept and nothing is written', () => {
  const plan = run({ existing: withDay(apply(run()), '2026-10-05_u1', 1, 'Waikato') })
  assert.equal(plan.schedules.length, 0); assert.equal(plan.conflicts.length, 0)
})
test('plan: changed in both places → one conflict, app kept (Excel wins only if asked)', () => {
  const existing = withDay(apply(run()), '2026-10-05_u1', 1, 'Waikato')
  const people = [{ name: 'Alex', team: 'Engineers', days: D('Cass Office', 'Dunedin', 'Tauranga', 'Cass Office', 'Leave'), comment: 'Back 12th' }]
  const plan = run({ existing, people })
  assert.equal(plan.conflicts.length, 1); assert.deepEqual([plan.conflicts[0].app, plan.conflicts[0].excel], ['Waikato', 'Dunedin'])
  assert.equal(run({ existing, people, excelWins: true }).schedules[0].days[1].location, 'Dunedin')
  // once seen, the same conflict isn't raised again
  assert.equal(run({ existing: apply(plan, existing), people }).conflicts.length, 0)
})
test('plan: entries already in the app (no history) are kept; blanks are filled', () => {
  const existing = new Map([['2026-10-05_u1', { days: [{ location: 'Waikato', onCall: false }, { location: '', onCall: false }, {}, {}, {}], comments: '' }]])
  const s = run({ existing }).schedules[0]
  assert.equal(s.days[0].location, 'Waikato'); assert.equal(s.days[1].location, 'Tauranga'); assert.equal(s.contentChanged, true)
})
test('plan: only a missing history is written, without touching content', () => {
  const existing = new Map([['2026-10-05_u1', { days: ['Cass Office', 'Tauranga', 'Tauranga', 'Cass Office', 'Leave'].map(location => ({ location, onCall: false })), comments: 'Back 12th' }]])
  const s = run({ existing }).schedules[0]
  assert.equal(s.contentChanged, false); assert.equal(s.baseChanged, true)
})
test('plan: the app’s customer-calls flag survives an import', () => {
  const existing = new Map([['2026-10-05_u1', { days: [{ location: '', onCall: true }, {}, {}, {}, {}], comments: '' }]])
  assert.equal(run({ existing }).schedules[0].days[0].onCall, true)
})
test('plan: someone with nothing in the Excel that week is skipped', () => assert.equal(run({ people: [{ name: 'Alex', team: 'Engineers', days: D(), comment: '' }] }).schedules.length, 0))
test('plan: new people are created as pending, on the Excel group’s team', () => {
  const plan = run({ people: [{ name: 'Casey', team: 'Engineers', days: D('Cass Office'), comment: '' }] })
  assert.deepEqual([...plan.newPeople.values()], [{ id: 'pending-casey', displayName: 'Casey', team: 'Engineers', excelName: 'Casey' }])
  assert.equal(plan.schedules[0].uid, 'pending-casey'); assert.equal(plan.schedules[0].team, 'Engineers')
})
test('plan: "- OnCall" sets the roster only when nobody is assigned yet', () => {
  const people = [{ name: 'Alex', team: 'Engineers', onCall: true, days: D('Cass Office'), comment: '' }]
  assert.deepEqual(run({ people }).onCall.map(o => [o.weekStart, o.displayName]), [['2026-10-05', 'Alex Morgan']])
  assert.equal(run({ people, existingOnCall: new Map([['2026-10-05', { uid: 'u3' }]]) }).onCall.length, 0)
})
test('plan: a repeated person in one week is flagged, the first row used', () => {
  const plan = run({ people: [{ name: 'Alex', team: 'Engineers', days: D('A'), comment: '' }, { name: 'Alex', team: 'Engineers', days: D('B'), comment: '' }] })
  assert.equal(plan.schedules.length, 1); assert.equal(plan.warnings.length, 1); assert.equal(plan.schedules[0].days[0].location, 'A')
})
test('plan: the Excel name is saved on a person the Excel calls something else — once', () => {
  const us = [{ uid: 'u8', displayName: 'Robert Brown', team: 'Admin' }]
  const people = [{ name: 'Bobby', team: 'Admin', days: D('Cass Office'), comment: '' }]
  const ppl = people.map(p => ({ key: nameKey(p.name), name: p.name, team: p.team }))
  const plan = planImport({ weeks: week(people), selected: ['2026-10-05'], mapping: buildMapping(ppl, matchPeople(ppl, us), us, { overrides: { bobby: 'u8' } }), users: us, existing: new Map(), existingOnCall: new Map() })
  assert.deepEqual([...plan.userUpdates], [['u8', { excelName: 'Bobby' }]])
  const named = [{ ...us[0], excelName: 'Bobby' }]
  assert.equal(planImport({ weeks: week(people), selected: ['2026-10-05'], mapping: buildMapping(ppl, matchPeople(ppl, named), named), users: named, existing: new Map(), existingOnCall: new Map() }).userUpdates.size, 0)
})
test('plan: week rows summarise each week', () => assert.deepEqual(run().weekRows.map(r => [r.weekStart, r.people, r.added, r.writes]), [['2026-10-05', 1, 5, 1]]))
