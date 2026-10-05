import { statusOf } from './status.js'
import { holidayOn } from './holidays.js'
import { DAY_SHORT, MONTHS_SHORT, addDaysISO, fromISO, toISO, weekStartOf, normalizeSchedule } from './week.js'

/**
 * Days out of town, for the quarterly FBT vehicle report that goes to the managers.
 * Out of town means out of Auckland — that's where the person is based — so a day at
 * NSH, Waitakere or Middlemore isn't one, but a day at a site in the Waikato or on a
 * course elsewhere is. Office, remote, work from home, non-working days, leave,
 * holidays and customer calls never count.
 */
const AWAY = new Set(['site', 'training'])

const parts = location => (location || '').split('/').map(p => p.trim()).filter(Boolean)

/**
 * The places a day was spent at a site or on a course ("Waikato", "EAS course").
 * `holiday` is the public holiday on that date, if any: what's typed about it
 * ("EASTER", "ANZAC", "Kings birthday NZ") is the holiday, not somewhere visited.
 * A place typed on a holiday still counts — someone was working there.
 */
export function awayPlaces(day, { holiday = '' } = {}) {
  return parts(day?.location).filter(p => AWAY.has(statusOf({ location: p }, holiday)))
}

// ── Auckland ──────────────────────────────────────────────────────────────

/**
 * Places in the Auckland region, so a day there isn't "out of town". A place is in
 * Auckland when any of these appears in it as whole words, in any case — "NSH",
 * "North Shore Hospital", "Middlemore Install", "SX Auckland Surgical". Anything not
 * listed counts as out of town, so a new city needs no change here; the Out of town
 * page shows what was skipped and what was counted, and lets the list be edited.
 * (The Auckland Council area runs from Warkworth to Pukekohe, hence those.)
 */
export const AUCKLAND_PLACES = [
  'auckland', 'north shore', 'nsh', 'waitakere', 'waitakare', 'waitemata', 'counties manukau', 'rodney', 'franklin', 'pukekohe',
  'takapuna', 'albany', 'glenfield', 'birkenhead', 'devonport', 'browns bay', 'orewa', 'whangaparaoa', 'silverdale', 'hibiscus coast', 'warkworth',
  'henderson', 'westgate', 'te atatu', 'new lynn', 'avondale', 'glen eden', 'titirangi', 'kumeu', 'helensville',
  'newmarket', 'parnell', 'remuera', 'epsom', 'greenlane', 'ellerslie', 'penrose', 'panmure', 'mt wellington', 'mount wellington',
  'mt eden', 'mount eden', 'mt albert', 'mount albert', 'grey lynn', 'ponsonby', 'onehunga', 'mangere', 'otahuhu', 'middlemore',
  'papatoetoe', 'manukau', 'botany', 'howick', 'pakuranga', 'east tamaki', 'highbrook', 'wiri', 'papakura', 'takanini', 'drury', 'starship',
]

/** Lower-case words with the macrons and punctuation gone: "Māngere Hospital" → ['mangere', 'hospital']. */
const words = text => String(text || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

const hasRun = (hay, needle) => {
  for (let i = 0; i + needle.length <= hay.length; i++) if (needle.every((w, j) => hay[i + j] === w)) return true
  return false
}

/** A function telling whether a place is in Auckland, for a list of place names. */
export function aucklandMatcher(list = AUCKLAND_PLACES) {
  const needles = list.map(words).filter(n => n.length)
  return place => { const hay = words(place); return needles.some(n => hasRun(hay, n)) }
}

export const inAuckland = (place, list = AUCKLAND_PLACES) => aucklandMatcher(list)(place)

/** "NSH, Waitakere" or one per line → ['NSH', 'Waitakere']. */
export const parsePlaces = text => String(text || '').split(/[,;\n]+/).map(s => s.trim()).filter(Boolean)

// ── days and trips ────────────────────────────────────────────────────────

/**
 * The days spent out of Auckland in the given weeks (from quarterSlices), read from
 * `schedules` ({ [weekStart]: days }): { away, skipped }, both in date order.
 * `away` is [{ iso, places }] — the places outside Auckland that day. `skipped` is
 * the days at a site that were all in Auckland, kept so the page can show them.
 */
export function awayDays(slices, schedules, { aucklandPlaces = AUCKLAND_PLACES } = {}) {
  const local = aucklandMatcher(aucklandPlaces)
  const away = []
  const skipped = []
  for (const s of slices) {
    const days = normalizeSchedule(schedules?.[s.weekStart])
    for (const i of s.indices) {
      const iso = addDaysISO(s.weekStart, i)
      const places = awayPlaces(days[i], { holiday: holidayOn(iso) })
      const outside = places.filter(p => !local(p))
      if (outside.length) away.push({ iso, places: outside })
      else if (places.length) skipped.push({ iso, places })
    }
  }
  return { away, skipped }
}

const isWeekend = iso => [0, 6].includes(fromISO(iso).getDay())
const nextWeekday = iso => { let d = addDaysISO(iso, 1); while (isWeekend(d)) d = addDaysISO(d, 1); return d }

/**
 * Runs of days in the same place, one record each — the FBT report lists a trip as
 * its place and the dates: [{ key, notes, places, dates }]. Days join when they are
 * consecutive weekdays (Friday then Monday counts) in the same place; a different
 * place, or a day at the office in between, starts a new record.
 */
export function tripsOf(days) {
  const trips = []
  for (const day of days) {
    const notes = day.places.join(', ')
    const key = notes.toLowerCase().replace(/\s+/g, ' ')
    const last = trips.at(-1)
    if (last && last.key === key && nextWeekday(last.dates.at(-1)) === day.iso) last.dates.push(day.iso)
    else trips.push({ key, notes, places: day.places, dates: [day.iso] })
  }
  return trips
}

/** "Mon 6 – Thu 9 Jul 2026", "Wed 22 Jul 2026" — a record's dates, for the screen. */
export function tripLabel(dates) {
  const f = iso => { const d = fromISO(iso); return { day: DAY_SHORT[d.getDay() - 1], n: d.getDate(), m: MONTHS_SHORT[d.getMonth()], y: d.getFullYear() } }
  const a = f(dates[0])
  const b = f(dates.at(-1))
  if (dates.length === 1) return `${a.day} ${a.n} ${a.m} ${a.y}`
  const from = a.y !== b.y ? `${a.day} ${a.n} ${a.m} ${a.y}` : a.m !== b.m ? `${a.day} ${a.n} ${a.m}` : `${a.day} ${a.n}`
  return `${from} – ${b.day} ${b.n} ${b.m} ${b.y}`
}

// ── quarters ──────────────────────────────────────────────────────────────

/**
 * A quarter named the way the FBT report names them — the financial year starts in
 * April, so Q1 is Apr–Jun and Jul–Sep is Q2: "Q2 (Jul-Sep) 2026". `q` is the
 * calendar quarter (1 = Jan–Mar); the year is that of the months themselves.
 * `from`/`to` are the first and last day.
 */
export function describeQuarter(year, q) {
  const first = (q - 1) * 3
  const fq = (q + 2) % 4 + 1
  const months = `${MONTHS_SHORT[first]}-${MONTHS_SHORT[first + 2]}`
  return {
    year,
    q,
    fq,
    months,
    label: `Q${fq} (${months}) ${year}`,
    from: toISO(new Date(year, first, 1)),
    to: toISO(new Date(year, first + 3, 0)),
  }
}

export function quarterOf(date) {
  const d = new Date(date)
  return describeQuarter(d.getFullYear(), Math.floor(d.getMonth() / 3) + 1)
}

/** The current quarter and the ones before it, newest first. */
export function recentQuarters(count = 8) {
  const now = new Date()
  return Array.from({ length: count }, (_, i) => quarterOf(new Date(now.getFullYear(), now.getMonth() - i * 3, 1)))
}

/**
 * The weeks a quarter touches, each with the weekdays of it that fall inside
 * the quarter — { weekStart, start, indices }, `start` being the first of them.
 * Days are counted by their own date, not by which quarter the week's Monday is
 * in, so "Jul-Sep" means 1 July to 30 September whatever day a week starts.
 * A week that crosses the edge of a quarter is split between the two quarters,
 * so every weekday lands in exactly one of them — none dropped, none twice.
 */
export function quarterSlices({ from, to }) {
  const slices = []
  for (let monday = weekStartOf(fromISO(from)); monday <= to; monday = addDaysISO(monday, 7)) {
    const indices = [0, 1, 2, 3, 4].filter(i => { const day = addDaysISO(monday, i); return day >= from && day <= to })
    if (indices.length) slices.push({ weekStart: monday, start: addDaysISO(monday, indices[0]), indices })
  }
  return slices
}
