// Run with `npm test`. Covers the Out of town report's pure logic: which quarter a day belongs to, which days
// count as out of town (out of Auckland), how days become trips, and public holidays typed by name.
// Places are made up or public place names — never put real staff data in this repo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AUCKLAND_PLACES, awayDays, awayPlaces, describeQuarter, inAuckland, parsePlaces,
  quarterOf, quarterSlices, recentQuarters, tripLabel, tripsOf,
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
  assert.deepEqual(none, { away: [], skipped: [] })
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
  assert.deepEqual(inQuarter(Q2, null), { away: [], skipped: [] })
})

test('the Auckland list in use decides what is skipped', () => {
  const schedules = { '2026-07-13': week('Hamilton', 'NSH', '', '', '') }
  // the list is the whole list: with only Hamilton on it, Hamilton is skipped and NSH is no longer Auckland
  assert.deepEqual(inQuarter(Q2, schedules, { aucklandPlaces: ['hamilton'] }).away.map(d => d.places), [['NSH']])
  assert.deepEqual(inQuarter(Q2, schedules, { aucklandPlaces: [] }).away.map(d => d.places), [['Hamilton'], ['NSH']])
  assert.deepEqual(inQuarter(Q2, schedules).away.map(d => d.places), [['Hamilton']]) // the standard list: NSH is skipped
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
