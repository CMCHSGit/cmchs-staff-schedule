// Run with `npm test`. Covers the Out of town report's pure logic: which quarter a day belongs to, which
// days count as out of town, and public holidays written by name. Every place here is made up.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeQuarter, quarterOf, recentQuarters, quarterSlices, partLabel, summariseWeek, awayPlaces } from '../src/utils/outOfTown.js'
import { statusOf, describeDay } from '../src/utils/status.js'
import { holidayOn } from '../src/utils/holidays.js'
import { addDaysISO } from '../src/utils/week.js'

const week = (...places) => places.map(location => ({ location }))

// ── quarters ──────────────────────────────────────────────────────────────

test('a quarter is named by its months, with its first and last day', () => {
  const q = describeQuarter(2026, 3)
  assert.equal(q.title, 'Jul – Sep 2026')
  assert.equal(q.months, 'Jul – Sep')
  assert.equal(q.from, '2026-07-01')
  assert.equal(q.to, '2026-09-30')
  assert.equal(describeQuarter(2026, 4).title, 'Oct – Dec 2026')
  assert.equal(describeQuarter(2026, 1).to, '2026-03-31')
  assert.equal(describeQuarter(2028, 1).from, '2028-01-01')
  assert.equal(quarterOf(new Date(2026, 8, 30)).title, 'Jul – Sep 2026')
})

test('recent quarters run newest first, with no gap or overlap between them', () => {
  const list = recentQuarters(6)
  assert.equal(list[0].title, quarterOf(new Date()).title)
  for (let i = 1; i < list.length; i++) assert.equal(addDaysISO(list[i].to, 1), list[i - 1].from)
})

test('Jul – Sep 2026 starts on Wed 1 Jul and ends on Wed 30 Sep, splitting the weeks either side', () => {
  const slices = quarterSlices(describeQuarter(2026, 3))
  assert.equal(slices.length, 14)
  assert.deepEqual(slices[0], { weekStart: '2026-06-29', start: '2026-07-01', indices: [2, 3, 4] })
  assert.deepEqual(slices[1], { weekStart: '2026-07-06', start: '2026-07-06', indices: [0, 1, 2, 3, 4] })
  assert.deepEqual(slices.at(-1), { weekStart: '2026-09-28', start: '2026-09-28', indices: [0, 1, 2] })
  assert.equal(slices.reduce((n, s) => n + s.indices.length, 0), 66) // 1 Jul – 30 Sep 2026 holds 66 weekdays
})

test('the week that is cut by one quarter’s end is picked up by the next quarter', () => {
  // Mon 28 Sep – Fri 2 Oct 2026: Mon–Wed are September, Thu–Fri are October
  const q4 = quarterSlices(describeQuarter(2026, 4))
  assert.deepEqual(q4[0], { weekStart: '2026-09-28', start: '2026-10-01', indices: [3, 4] })
  assert.deepEqual(q4.at(-1), { weekStart: '2026-12-28', start: '2026-12-28', indices: [0, 1, 2, 3] })
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

test('part-weeks are labelled by the days that count', () => {
  assert.equal(partLabel([2, 3, 4]), 'Wed–Fri')
  assert.equal(partLabel([0, 1, 2]), 'Mon–Wed')
  assert.equal(partLabel([3, 4]), 'Thu–Fri')
  assert.equal(partLabel([4]), 'Fri')
  assert.equal(partLabel([0, 1, 2, 3, 4]), '')
})

// ── counting days ─────────────────────────────────────────────────────────

test('a week counts the days at a site or on a course, and lists each place once', () => {
  const days = week('Waikato', 'Waikato', 'Hamilton', 'Cass Office', 'Tauranga')
  assert.deepEqual(summariseWeek(days), { days: 4, reason: 'Waikato, Hamilton, Tauranga' })
})

test('only the days inside the quarter are counted for a part-week', () => {
  const days = week('Waikato', 'Waikato', 'Hamilton', 'Cass Office', 'Tauranga')
  assert.deepEqual(summariseWeek(days, { only: [2, 3, 4] }), { days: 2, reason: 'Hamilton, Tauranga' }) // the start of a quarter
  assert.deepEqual(summariseWeek(days, { only: [0, 1] }), { days: 2, reason: 'Waikato' })               // the end of a quarter
  // …so the two halves of a split week always add up to the whole week
  assert.equal(summariseWeek(days, { only: [0, 1] }).days + summariseWeek(days, { only: [2, 3, 4] }).days, summariseWeek(days).days)
})

test('office, remote, home, calls and holidays are not out of town; leave only when asked', () => {
  const days = week('Cass Office', 'Remote Support', 'Work from Home', 'Public Holiday', 'Annual Leave')
  assert.equal(summariseWeek(days).days, 0)
  assert.equal(summariseWeek(days, { countLeave: true }).days, 1)
  assert.equal(summariseWeek(days, { countLeave: true, only: [0, 1, 2, 3] }).days, 0)
})

test('a day with a site and the office still counts once', () => {
  assert.deepEqual(awayPlaces({ location: 'Starship / Cass Office' }), ['Starship'])
  assert.equal(summariseWeek(week('Starship / Cass Office', '', '', '', '')).days, 1)
})

// ── holidays written by name ──────────────────────────────────────────────

test('a public holiday written by its name is a holiday, not a place to visit', () => {
  for (const text of [
    'Matariki Day', 'Matariki', 'matariki day', 'Waitangi Day', 'ANZAC Day (observed)', 'Labour Day', 'Boxing Day',
    "New Year's Day", 'New Years Day', 'Day after New Year', 'Good Friday', 'Easter Monday', "King's Birthday",
    'Auckland Anniversary', 'Public Holiday',
  ]) assert.equal(statusOf({ location: text }), 'holiday', text)
})

test('Matariki Day is not counted as a day out of town', () => {
  assert.deepEqual(summariseWeek(week('Cass Office', 'Cass Office', 'Cass Office', 'Cass Office', 'Matariki Day')), { days: 0, reason: '' })
  assert.deepEqual(awayPlaces({ location: 'Matariki Day / Waikato' }), ['Waikato']) // working at a site that day still counts
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

test('the three entries that were still being counted: EASTER, ANZAC and Kings birthday NZ', () => {
  // Good Friday Fri 3 Apr, ANZAC Day observed Mon 27 Apr and King's Birthday Mon 1 Jun 2026
  assert.equal(holidayOn('2026-04-03'), 'Good Friday')
  assert.equal(holidayOn('2026-04-27'), 'ANZAC Day (observed)')
  assert.equal(holidayOn('2026-06-01'), "King's Birthday")
  assert.deepEqual(summariseWeek(week('Cass Office', 'Cass Office', 'Cass Office', 'Cass Office', 'EASTER'), { only: [2, 3, 4], weekStart: '2026-03-30' }), { days: 0, reason: '' })
  assert.deepEqual(summariseWeek(week('ANZAC', 'Middlemore', 'Cass Office', 'Cass Office', 'Cass Office'), { weekStart: '2026-04-27' }), { days: 1, reason: 'Middlemore' })
  assert.deepEqual(summariseWeek(week('Kings birthday NZ', 'Cass Office', 'Cass Office', 'Cass Office', 'Cass Office'), { weekStart: '2026-06-01' }), { days: 0, reason: '' })
  // and with no dates at all (the text alone is enough for these)
  assert.equal(summariseWeek(week('EASTER', 'ANZAC', 'Kings birthday NZ', '', '')).days, 0)
})

test('on a holiday’s own date, what is typed about it is the holiday — on any other day it is a place', () => {
  // Fri 6 Feb 2026 is Waitangi Day; Mon 26 Oct 2026 is Labour Day
  assert.equal(summariseWeek(week('', '', '', '', 'Waitangi'), { weekStart: '2026-02-02' }).days, 0)
  assert.equal(summariseWeek(week('Waitangi', '', '', '', ''), { weekStart: '2026-02-02' }).days, 1) // Mon 2 Feb: just a place in Northland
  assert.equal(summariseWeek(week('Labour', '', '', '', ''), { weekStart: '2026-10-26' }).days, 0)
  assert.equal(summariseWeek(week('Labour ward', '', '', '', ''), { weekStart: '2026-10-26' }).days, 1) // a ward is still a ward
  assert.equal(summariseWeek(week('Holiday', '', '', '', ''), { weekStart: '2026-10-26' }).days, 0)
  assert.equal(statusOf({ location: 'Holiday' }, "King's Birthday"), 'holiday') // not leave: a public holiday isn't a leave day
  assert.equal(statusOf({ location: 'Holiday' }), 'leave')                      // on an ordinary day it still is
})

test('a place typed on a holiday still counts, and so does one next to the holiday', () => {
  assert.deepEqual(summariseWeek(week('Waikato', '', '', '', ''), { weekStart: '2026-10-26' }), { days: 1, reason: 'Waikato' })
  assert.deepEqual(summariseWeek(week('Labour Day / Waikato', '', '', '', ''), { weekStart: '2026-10-26' }), { days: 1, reason: 'Waikato' })
})

test('views show a holiday typed in a day as a holiday', () => {
  assert.equal(describeDay({ location: 'EASTER' }, 'Good Friday').status, 'holiday')
  assert.equal(describeDay({ location: 'Waitangi' }, 'Waitangi Day').status, 'holiday')
  assert.equal(describeDay({ location: 'Waitangi' }).status, 'site')
  assert.equal(describeDay({ location: '' }, 'Matariki').text, 'Matariki') // an empty day still shows the holiday's own name
})
