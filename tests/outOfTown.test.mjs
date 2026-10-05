// Run with `npm test`. Covers the Out of town report's pure logic: which quarter a day belongs to, which days
// count as out of town (out of Auckland), how days become trips, and public holidays typed by name.
// Places are made up or public place names — never put real staff data in this repo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AUCKLAND_PLACES, awayDays, awayPlaces, chooseSchedules, describeQuarter, inAuckland, isCarWork, parsePlaces,
  quarterOf, quarterSlices, readDays, recentQuarters, reportDays, reportNotes, reportTrips, tripId, tripLabel, tripsOf, updateEdits, withEdits,
} from '../src/utils/outOfTown.js'
import { statusOf, describeDay } from '../src/utils/status.js'
import { holidayOn } from '../src/utils/holidays.js'
import { addDaysISO } from '../src/utils/week.js'

/** A week as the app stores it: five { location } days. */
const week = (...places) => places.map(location => ({ location }))
/** The days out of Auckland in a quarter, from { [weekStart]: week }. */
const inQuarter = (quarter, schedules, options) => awayDays(quarterSlices(quarter), schedules, options)

// ── quarters ──────────────────────────────────────────────────────────────

test('quarters are named the way the FBT report names them — the financial year starts in April', () => {
  assert.equal(describeQuarter(2026, 2).label, 'Q1 (Apr-Jun) 2026')
  assert.equal(describeQuarter(2026, 3).label, 'Q2 (Jul-Sep) 2026')
  assert.equal(describeQuarter(2026, 4).label, 'Q3 (Oct-Dec) 2026')
  assert.equal(describeQuarter(2027, 1).label, 'Q4 (Jan-Mar) 2027')
  const q = describeQuarter(2026, 3)
  assert.equal(q.from, '2026-07-01')
  assert.equal(q.to, '2026-09-30')
  assert.equal(describeQuarter(2026, 1).to, '2026-03-31')
  assert.equal(quarterOf(new Date(2026, 8, 30)).label, 'Q2 (Jul-Sep) 2026')
  assert.equal(quarterOf(new Date(2027, 0, 1)).label, 'Q4 (Jan-Mar) 2027')
})

test('recent quarters run newest first, with no gap or overlap between them', () => {
  const list = recentQuarters(6)
  assert.equal(list[0].label, quarterOf(new Date()).label)
  for (let i = 1; i < list.length; i++) assert.equal(addDaysISO(list[i].to, 1), list[i - 1].from)
})

test('Q2 (Jul-Sep) 2026 starts on Wed 1 Jul and ends on Wed 30 Sep, splitting the weeks either side', () => {
  const slices = quarterSlices(describeQuarter(2026, 3))
  assert.equal(slices.length, 14)
  assert.deepEqual(slices[0], { weekStart: '2026-06-29', start: '2026-07-01', indices: [2, 3, 4] })
  assert.deepEqual(slices[1], { weekStart: '2026-07-06', start: '2026-07-06', indices: [0, 1, 2, 3, 4] })
  assert.deepEqual(slices.at(-1), { weekStart: '2026-09-28', start: '2026-09-28', indices: [0, 1, 2] })
  assert.equal(slices.reduce((n, s) => n + s.indices.length, 0), 66) // 1 Jul – 30 Sep 2026 holds 66 weekdays
})

test('the week that is cut by one quarter’s end is picked up by the next quarter', () => {
  // Mon 28 Sep – Fri 2 Oct 2026: Mon–Wed are September, Thu–Fri are October
  const next = quarterSlices(describeQuarter(2026, 4))
  assert.deepEqual(next[0], { weekStart: '2026-09-28', start: '2026-10-01', indices: [3, 4] })
  assert.deepEqual(next.at(-1), { weekStart: '2026-12-28', start: '2026-12-28', indices: [0, 1, 2, 3] })
})

test('every weekday of a year falls in exactly one quarter — none dropped, none counted twice', () => {
  for (const year of [2025, 2026, 2027, 2028, 2032]) {
    const seen = new Map()
    for (let q = 1; q <= 4; q++) {
      for (const s of quarterSlices(describeQuarter(year, q))) {
        for (const i of s.indices) {
          const day = addDaysISO(s.weekStart, i)
          seen.set(day, (seen.get(day) || 0) + 1)
        }
      }
    }
    let weekdays = 0
    for (let d = new Date(year, 0, 1); d.getFullYear() === year; d.setDate(d.getDate() + 1)) if (d.getDay() % 6 !== 0) weekdays++
    assert.equal(seen.size, weekdays, `${year}: weekdays covered`)
    assert.ok([...seen.values()].every(n => n === 1), `${year}: a day was counted twice`)
  }
})

test('a quarter that starts on a weekend has no empty first week', () => {
  const slices = quarterSlices(describeQuarter(2028, 1)) // 1 Jan 2028 is a Saturday
  assert.equal(slices[0].weekStart, '2028-01-03')
  assert.equal(slices[0].indices.length, 5)
  assert.ok(slices.every(s => s.indices.length > 0))
})

// ── Auckland ──────────────────────────────────────────────────────────────

test('sites in Auckland are not out of town — NSH, Waitakere and the rest', () => {
  for (const place of [
    'NSH', 'nsh', 'North Shore Hospital', 'Waitakere', 'Waitakare', 'Middlemore Install', 'Greenlane Medical Specialist',
    'SX Auckland Surgical', 'Franklin PMV', 'Starship', 'Māngere Hospital', 'Mt Eden', 'Mount Wellington', 'Albany',
  ]) assert.ok(inAuckland(place), place)
})

test('anywhere else is out of town, including places that merely contain an Auckland word', () => {
  for (const place of [
    'Waikato', 'Hamilton', 'Anglesea Day Surgery', 'Rotorua', 'Taupo', 'Thames', 'Hastings', 'Hawkes Bay', 'Wellington', 'Christchurch',
    'Dunedin', 'New Plymouth', 'Masterton', 'Panshaw Clinic', // “nsh” inside a word isn’t NSH
  ]) assert.ok(!inAuckland(place), place)
})

test('the Auckland list can be changed', () => {
  assert.ok(AUCKLAND_PLACES.includes('nsh') && AUCKLAND_PLACES.includes('waitakere'))
  assert.ok(inAuckland('Hamilton', ['hamilton']))
  assert.ok(!inAuckland('NSH', []))
  assert.deepEqual(parsePlaces('NSH, Waitakere\nstarship;  ,'), ['NSH', 'Waitakere', 'starship'])
})

// ── days ──────────────────────────────────────────────────────────────────

const Q2 = describeQuarter(2026, 3) // Jul-Sep 2026

test('only a site or a course out of Auckland counts: not the office, remote, home, leave or a holiday', () => {
  const none = inQuarter(Q2, { '2026-07-13': week('Cass Office', 'Remote Support', 'Work from Home', 'Annual Leave', 'Public Holiday') })
  assert.deepEqual(none, { away: [], skipped: [], service: [] })
  const some = inQuarter(Q2, { '2026-07-13': week('Hamilton', 'Rotorua', 'EAS course', '', '') })
  assert.deepEqual(some.away.map(d => [d.iso, d.places]), [['2026-07-13', ['Hamilton']], ['2026-07-14', ['Rotorua']], ['2026-07-15', ['EAS course']]])
})

test('days at a site in Auckland are skipped, and kept in a list to show', () => {
  const days = inQuarter(Q2, { '2026-07-13': week('NSH', 'Waitakere', 'Middlemore Install', 'Waikato', 'Cass Office') })
  assert.deepEqual(days.away, [{ iso: '2026-07-16', places: ['Waikato'] }])
  assert.deepEqual(days.skipped.map(d => [d.iso, d.places]), [['2026-07-13', ['NSH']], ['2026-07-14', ['Waitakere']], ['2026-07-15', ['Middlemore Install']]])
})

test('a day split between Auckland and elsewhere counts for the place outside Auckland', () => {
  const days = inQuarter(Q2, { '2026-07-13': week('Waikato / NSH', 'Waikato / Hamilton', 'Starship / Cass Office', '', '') })
  assert.deepEqual(days.away, [
    { iso: '2026-07-13', places: ['Waikato'] },
    { iso: '2026-07-14', places: ['Waikato', 'Hamilton'] },
  ])
  assert.deepEqual(days.skipped, [{ iso: '2026-07-15', places: ['Starship'] }])
})

test('only the days inside the quarter are looked at, and a missing week is nothing', () => {
  // the week of 29 Jun: Mon–Tue are in the previous quarter, Wed–Fri are in this one
  const days = inQuarter(Q2, { '2026-06-29': week('Waikato', 'Waikato', 'Hamilton', 'Hamilton', 'Cass Office') })
  assert.deepEqual(days.away.map(d => d.iso), ['2026-07-01', '2026-07-02'])
  assert.deepEqual(inQuarter(Q2, null), { away: [], skipped: [], service: [] })
})

test('the Auckland list in use decides what is skipped', () => {
  const schedules = { '2026-07-13': week('Hamilton', 'NSH', '', '', '') }
  // the list is the whole list: with only Hamilton on it, Hamilton is skipped and NSH is no longer Auckland
  assert.deepEqual(inQuarter(Q2, schedules, { aucklandPlaces: ['hamilton'] }).away.map(d => d.places), [['NSH']])
  assert.deepEqual(inQuarter(Q2, schedules, { aucklandPlaces: [] }).away.map(d => d.places), [['Hamilton'], ['NSH']])
  assert.deepEqual(inQuarter(Q2, schedules).away.map(d => d.places), [['Hamilton']]) // the standard list: NSH is skipped
})

// ── the car in for a service or repair ────────────────────────────────────

test('a part of a day about the car being serviced or repaired is recognised', () => {
  for (const text of ['Car service', 'car in for service', 'Car repair', 'Car in for repairs', 'Vehicle being serviced', 'Service car', 'Car at the garage', 'Vehicle servicing'])
    assert.ok(isCarWork(text), text)
})

test('a service or repair job at a customer is not the car going in', () => {
  for (const text of ['A7 service training', 'Service and repair of the monitors', 'Servicing at Waikato Hospital', 'Car park', 'Cass Office', 'Hamilton', 'Repair'])
    assert.ok(!isCarWork(text), text)
})

test('a day with the car in for service is its own kind, and the car is not a place', () => {
  const found = inQuarter(Q2, { '2026-07-13': week('Cass Office / Car service', 'Car in for repair', 'Hamilton', 'Waikato / Car service', 'Cass Office') })
  assert.deepEqual(found.service.map(d => [d.iso, d.places]), [['2026-07-13', ['Car service']], ['2026-07-14', ['Car in for repair']], ['2026-07-16', ['Car service']]])
  assert.deepEqual(found.away.map(d => d.iso), ['2026-07-15'])  // Wed: Hamilton
  assert.deepEqual(found.skipped, [])
  assert.deepEqual(awayPlaces({ location: 'Waikato / Car service' }), ['Waikato']) // the car isn't somewhere visited
})

test('every day on the report is in one kind only, listed in date order', () => {
  const found = inQuarter(Q2, { '2026-07-13': week('Hamilton', 'NSH', 'Car service', 'Waikato / NSH', 'Cass Office') })
  assert.deepEqual(reportDays(found).map(d => [d.iso, d.kind, d.places]), [
    ['2026-07-13', 'away', ['Hamilton']],
    ['2026-07-14', 'auckland', ['NSH']],
    ['2026-07-15', 'service', ['Car service']],
    ['2026-07-16', 'away', ['Waikato']],
  ])
})

test('service days and site days make separate records, and consecutive service days make one', () => {
  const trips = tripsOf(reportDays({
    away: [day('2026-07-13', 'Hamilton')],
    skipped: [day('2026-07-14', 'NSH')],
    service: [day('2026-07-15', 'Car service'), day('2026-07-16', 'Car service'), day('2026-07-17', 'Hamilton')],
  }))
  assert.deepEqual(trips.map(t => [t.kind, t.notes, t.dates.length]), [['away', 'Hamilton', 1], ['auckland', 'NSH', 1], ['service', 'Car service', 2], ['service', 'Hamilton', 1]])
})

test('a service record has its own id, and the ids saved before service records existed still fit', () => {
  assert.equal(tripId({ kind: 'service', key: 'car service', dates: ['2026-08-11'] }), '2026-08-11|service|car service')
  assert.equal(tripId({ kind: 'away', key: 'hamilton', dates: ['2026-07-13'] }), '2026-07-13|hamilton')
  assert.equal(tripId({ kind: 'auckland', key: 'nsh', dates: ['2026-07-14'] }), '2026-07-14|nsh') // a place that became Auckland keeps its notes
  assert.equal(tripId({ key: 'hamilton', dates: ['2026-07-13'] }), '2026-07-13|hamilton')
})

test('the report row says which kind a record is', () => {
  const rows = withEdits(tripsOf(reportDays({ away: [day('2026-07-13', 'Hamilton')], skipped: [day('2026-07-14', 'NSH')], service: [day('2026-07-15', 'Car service')] })), { '2026-07-14|nsh': { include: false } })
  assert.deepEqual(reportTrips(rows).map(r => [r.kind, r.notes]), [['away', 'Hamilton'], ['service', 'Car service']]) // the unticked Auckland one is out
})

// ── trips ─────────────────────────────────────────────────────────────────

const day = (iso, ...places) => ({ iso, places })

test('consecutive days in the same place are one record; a different place starts another', () => {
  const trips = tripsOf([
    day('2026-07-06', 'Hastings'), day('2026-07-07', 'Hastings'), day('2026-07-08', 'Hastings'), day('2026-07-09', 'Hastings'),
    day('2026-07-13', 'Masterton'), day('2026-07-14', 'Masterton'),
    day('2026-07-20', 'Hawkes Bay'), day('2026-07-21', 'Hawkes Bay'), day('2026-07-22', 'Wellington'),
  ])
  assert.deepEqual(trips.map(t => [t.notes, t.dates.length]), [['Hastings', 4], ['Masterton', 2], ['Hawkes Bay', 2], ['Wellington', 1]])
  assert.deepEqual(trips[0].dates, ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09'])
})

test('a trip carries on over a weekend, but not over a day back in the office', () => {
  const over = tripsOf([day('2026-08-13', 'Dunedin'), day('2026-08-14', 'Dunedin'), day('2026-08-17', 'Dunedin')]) // Thu, Fri, Mon
  assert.deepEqual(over.map(t => t.dates.length), [3])
  const split = tripsOf([day('2026-08-10', 'Dunedin'), day('2026-08-12', 'Dunedin')]) // Mon, Wed — Tuesday was elsewhere
  assert.deepEqual(split.map(t => t.dates.length), [1, 1])
})

test('the same place written two ways is still one trip', () => {
  assert.deepEqual(tripsOf([day('2026-08-10', 'Dunedin'), day('2026-08-11', 'DUNEDIN')]).map(t => t.dates.length), [2])
})

test('two days in the same place with a day in the office between are two records, and both are counted', () => {
  // Mon 24 and Wed 26 Aug 2026 at the same site, the rest of the week in the office
  const days = inQuarter(Q2, { '2026-08-24': week('Anglesea', 'Cass Office', 'Anglesea', 'Cass Office', 'Cass Office') })
  assert.deepEqual(days.away.map(d => d.iso), ['2026-08-24', '2026-08-26'])
  const trips = tripsOf(days.away)
  assert.deepEqual(trips.map(t => [tripLabel(t.dates), t.dates.length, t.notes]), [['Mon 24 Aug 2026', 1, 'Anglesea'], ['Wed 26 Aug 2026', 1, 'Anglesea']])
  assert.equal(trips.reduce((n, t) => n + t.dates.length, 0), 2)
})

test('the read-out shows every weekday of a saved week and how each was counted', () => {
  const out = readDays(quarterSlices(Q2), { '2026-08-24': week('Anglesea', 'Cass Office', 'Anglesea', 'Car service', 'NSH') })
  assert.deepEqual(out.find(w => w.weekStart === '2026-08-24').days.map(d => [d.iso, d.text, d.verdict]), [
    ['2026-08-24', 'Anglesea', 'away'], ['2026-08-25', 'Cass Office', 'no'], ['2026-08-26', 'Anglesea', 'away'],
    ['2026-08-27', 'Car service', 'service'], ['2026-08-28', 'NSH', 'auckland'],
  ])
  assert.deepEqual(out.find(w => w.weekStart === '2026-08-17'), { weekStart: '2026-08-17', saved: false, days: [] }) // nothing saved
  assert.equal(out.length, 14)
  // a holiday typed by name is "not out of town", not a place
  const holiday = readDays(quarterSlices(describeQuarter(2026, 2)), { '2026-03-30': week('', '', '', '', 'EASTER') })
  assert.equal(holiday[0].days.at(-1).verdict, 'no')
})

test('a week stored twice uses the most recently saved copy, and says so', () => {
  const stamp = ms => ({ toMillis: () => ms })
  const monday = week('Anglesea', '', '', '', '')
  const both = week('Anglesea', '', 'Anglesea', '', '')
  const chosen = chooseSchedules([
    { id: 'old', weekStart: '2026-08-24', days: monday, submittedAt: stamp(100) },
    { id: 'new', weekStart: '2026-08-24', days: both, submittedAt: stamp(200) },
    { id: 'imported', weekStart: '2026-08-31', days: monday, importedAt: stamp(50) },
  ])
  assert.deepEqual(chosen.schedules['2026-08-24'], both)
  assert.deepEqual(chosen.copies, [['2026-08-24', ['old', 'new']]])
  assert.deepEqual(Object.keys(chosen.schedules).sort(), ['2026-08-24', '2026-08-31'])
  assert.deepEqual(chooseSchedules([]), { schedules: {}, copies: [] })
})

// ── what the person adds to each record ───────────────────────────────────

const trip = (notes, ...dates) => ({ key: notes.toLowerCase(), notes, places: [notes], dates })

test('what is typed against a record is laid over it, and the schedule’s place stays as the default', () => {
  const trips = [trip('Hamilton', '2026-07-13'), trip('Rotorua', '2026-08-11')]
  assert.deepEqual(withEdits(trips).map(r => [r.id, r.include, r.text]), [['2026-07-13|hamilton', true, 'Hamilton'], ['2026-08-11|rotorua', true, 'Rotorua']])
  const edited = withEdits(trips, { '2026-07-13|hamilton': { notes: 'Software upgrade at the hospital' }, '2026-08-11|rotorua': { include: false } })
  assert.equal(edited[0].text, 'Software upgrade at the hospital')
  assert.equal(edited[0].notes, 'Hamilton') // the schedule's own place is kept alongside
  assert.equal(edited[1].include, false)
})

test('only what differs from the schedule is kept, so a corrected schedule isn’t held back by an old edit', () => {
  const [row] = withEdits([trip('Hamilton', '2026-07-13')])
  let edits = updateEdits({}, row, { notes: 'Install at the hospital' })
  assert.deepEqual(edits, { [row.id]: { notes: 'Install at the hospital' } })
  edits = updateEdits(edits, row, { notes: 'Hamilton' }) // typed back to what the schedule says
  assert.deepEqual(edits, {})
  edits = updateEdits(edits, row, { include: false })
  assert.deepEqual(edits, { [row.id]: { include: false } })
  edits = updateEdits(edits, row, { include: true }) // ticked again
  assert.deepEqual(edits, {})
  assert.deepEqual(updateEdits({ [row.id]: { notes: 'x' } }, row, { notes: undefined }), {}) // "Use this"
  const other = { '2026-08-11|rotorua': { notes: 'y' } } // another record's edits are left alone
  assert.deepEqual(updateEdits(other, row, { include: false }), { ...other, [row.id]: { include: false } })
})

test('the report takes the ticked records, each notes on one line, falling back to the place if cleared', () => {
  const rows = withEdits([trip('Hamilton', '2026-07-13'), trip('Rotorua', '2026-08-11'), trip('Tauranga', '2026-09-01')], {
    '2026-07-13|hamilton': { notes: '  Upgraded   the software\n at the hospital ' },
    '2026-08-11|rotorua': { include: false },
    '2026-09-01|tauranga': { notes: '   ' },
  })
  assert.deepEqual(reportTrips(rows), [
    { kind: 'away', notes: 'Upgraded the software at the hospital', dates: ['2026-07-13'] },
    { kind: 'away', notes: 'Tauranga', dates: ['2026-09-01'] },
  ])
})

test('the location and the additional notes are put together on the report', () => {
  const rows = withEdits([trip('Anglesea Day Surgery', '2026-08-17'), trip('Hamilton', '2026-07-13'), trip('Rotorua', '2026-08-11')], {
    '2026-08-17|anglesea day surgery': { details: '  DOR   install ' },
    '2026-07-13|hamilton': { notes: 'Waikato Hospital', details: 'A7 service training' },
    '2026-08-11|rotorua': { notes: 'Rotorua Hospital' }, // saved before there was a second box: it is simply the location
  })
  assert.deepEqual(rows.map(r => [r.text, r.details]), [['Anglesea Day Surgery', '  DOR   install '], ['Waikato Hospital', 'A7 service training'], ['Rotorua Hospital', '']])
  assert.deepEqual(reportTrips(rows).map(r => r.notes), ['Anglesea Day Surgery DOR install', 'Waikato Hospital A7 service training', 'Rotorua Hospital'])
})

test('only what was added is kept; a cleared location leaves just the details, and nothing at all falls back to the place', () => {
  const [row] = withEdits([trip('Hamilton', '2026-07-13')])
  let edits = updateEdits({}, row, { details: 'Software upgrade' })
  assert.deepEqual(edits, { [row.id]: { details: 'Software upgrade' } })
  assert.deepEqual(updateEdits(edits, row, { details: '   ' }), {}) // cleared
  edits = updateEdits({}, row, { notes: '', details: 'Server cabinet install at the hospital' })
  assert.equal(reportNotes(withEdits([trip('Hamilton', '2026-07-13')], edits)[0]), 'Server cabinet install at the hospital')
  assert.equal(reportNotes({ text: '', details: '', notes: 'Hamilton' }), 'Hamilton')
  assert.equal(reportNotes({ text: 'Hamilton', details: 'line one\nline two', notes: 'Hamilton' }), 'Hamilton line one line two')
})

test('a record keeps its edits when more is added to it, but not when it moves to another date', () => {
  const before = withEdits([trip('Hamilton', '2026-07-13')], { '2026-07-13|hamilton': { notes: 'kept' } })
  const grown = withEdits([trip('Hamilton', '2026-07-13', '2026-07-14')], { '2026-07-13|hamilton': { notes: 'kept' } })
  assert.equal(before[0].text, 'kept')
  assert.equal(grown[0].text, 'kept')
  assert.equal(withEdits([trip('Hamilton', '2026-07-14')], { '2026-07-13|hamilton': { notes: 'kept' } })[0].text, 'Hamilton')
})

test('a record’s dates read for the screen', () => {
  assert.equal(tripLabel(['2026-07-22']), 'Wed 22 Jul 2026')
  assert.equal(tripLabel(['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09']), 'Mon 6 – Thu 9 Jul 2026')
  assert.equal(tripLabel(['2026-08-31', '2026-09-01', '2026-09-02']), 'Mon 31 Aug – Wed 2 Sep 2026')
  assert.equal(tripLabel(['2025-12-31', '2026-01-02']), 'Wed 31 Dec 2025 – Fri 2 Jan 2026')
})

// ── holidays written by name ──────────────────────────────────────────────

test('a public holiday written by its name is a holiday, not a place to visit', () => {
  for (const text of [
    'Matariki Day', 'Matariki', 'matariki day', 'Waitangi Day', 'ANZAC Day (observed)', 'Labour Day', 'Boxing Day',
    "New Year's Day", 'New Years Day', 'Day after New Year', 'Good Friday', 'Easter Monday', "King's Birthday",
    'Auckland Anniversary', 'Public Holiday',
  ]) assert.equal(statusOf({ location: text }), 'holiday', text)
})

test('holidays typed the way people shorten them are holidays too', () => {
  for (const text of [
    'EASTER', 'Easter break', 'ANZAC', 'anzac day', 'Kings birthday NZ', "King's Birthday (NZ)", 'Queens Birthday', 'Christmas', 'XMAS', 'Xmas Day',
    'New Year', 'New Years', 'Wellington Anniversary', 'Wellington Anniversary Day', 'Canterbury Show Day', 'Show Day', 'PH', 'Stat', 'Pub hol',
  ]) assert.equal(statusOf({ location: text }), 'holiday', text)
})

test('places that share a word with a holiday are still places', () => {
  for (const text of ['Waitangi', 'Anzac Parade', 'Labour ward', 'Starship 20th Anniversary', 'Anglesea Day Surgery', 'Anglesea Day Hamilton', 'Matariki School', 'Kings College', 'Trade show'])
    assert.equal(statusOf({ location: text }), 'site', text)
})

test('EASTER, ANZAC and Kings birthday NZ are not days out of town', () => {
  // Good Friday Fri 3 Apr, ANZAC Day observed Mon 27 Apr and King's Birthday Mon 1 Jun 2026
  assert.equal(holidayOn('2026-04-03'), 'Good Friday')
  assert.equal(holidayOn('2026-04-27'), 'ANZAC Day (observed)')
  assert.equal(holidayOn('2026-06-01'), "King's Birthday")
  const days = inQuarter(describeQuarter(2026, 2), { // Apr–Jun 2026
    '2026-03-30': week('Cass Office', 'Cass Office', 'Cass Office', 'Cass Office', 'EASTER'),
    '2026-04-27': week('ANZAC', 'Hamilton', 'Cass Office', 'Cass Office', 'Cass Office'),
    '2026-06-01': week('Kings birthday NZ', 'Cass Office', 'Cass Office', 'Cass Office', 'Cass Office'),
  })
  assert.deepEqual(days.away, [{ iso: '2026-04-28', places: ['Hamilton'] }])
  assert.deepEqual(days.skipped, [])
})

test('on a holiday’s own date, what is typed about it is the holiday — on any other day it is a place', () => {
  // Fri 6 Feb 2026 is Waitangi Day; Mon 26 Oct 2026 is Labour Day
  const feb = inQuarter(describeQuarter(2026, 1), { '2026-02-02': week('Waitangi', 'Cass Office', 'Cass Office', 'Cass Office', 'Waitangi') })
  assert.deepEqual(feb.away, [{ iso: '2026-02-02', places: ['Waitangi'] }]) // the Monday is a place in Northland, the Friday is the holiday
  const oct = inQuarter(describeQuarter(2026, 4), { '2026-10-26': week('Labour ward', 'Cass Office', 'Cass Office', 'Cass Office', 'Cass Office') })
  assert.deepEqual(oct.away, [{ iso: '2026-10-26', places: ['Labour ward'] }]) // a ward is still a ward
  for (const text of ['Labour', 'Holiday', 'PH']) {
    assert.deepEqual(inQuarter(describeQuarter(2026, 4), { '2026-10-26': week(text, '', '', '', '') }).away, [], text)
  }
  assert.equal(statusOf({ location: 'Holiday' }, "King's Birthday"), 'holiday') // not leave: a public holiday isn't a leave day
  assert.equal(statusOf({ location: 'Holiday' }), 'leave')                      // on an ordinary day it still is
})

test('a place typed on a holiday still counts, because someone was working there', () => {
  const oct = describeQuarter(2026, 4)
  assert.deepEqual(inQuarter(oct, { '2026-10-26': week('Waikato', '', '', '', '') }).away, [{ iso: '2026-10-26', places: ['Waikato'] }])
  assert.deepEqual(inQuarter(oct, { '2026-10-26': week('Labour Day / Waikato', '', '', '', '') }).away, [{ iso: '2026-10-26', places: ['Waikato'] }])
  assert.deepEqual(awayPlaces({ location: 'Matariki Day / Waikato' }), ['Waikato'])
})

test('views show a holiday typed in a day as a holiday', () => {
  assert.equal(describeDay({ location: 'EASTER' }, 'Good Friday').status, 'holiday')
  assert.equal(describeDay({ location: 'Waitangi' }, 'Waitangi Day').status, 'holiday')
  assert.equal(describeDay({ location: 'Waitangi' }).status, 'site')
  assert.equal(describeDay({ location: '' }, 'Matariki').text, 'Matariki') // an empty day still shows the holiday's own name
})
