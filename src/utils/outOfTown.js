import { statusOf } from './status.js'
import { holidayOn } from './holidays.js'
import { DAY_SHORT, MONTHS_SHORT, addDaysISO, fromISO, toISO, weekStartOf, normalizeSchedule } from './week.js'

/**
 * The days that go on the quarterly FBT vehicle report that the managers get — each
 * one a day the car wasn't available for private use, in one of three kinds:
 *  - 'away': at a site or on a course out of town, i.e. outside Auckland (that's where
 *    the person is based);
 *  - 'auckland': at a site inside Auckland (NSH, Waitakere, Middlemore…). Listed too and
 *    flagged, so each can be ticked or not;
 *  - 'service': the car in for a service or repair, written in the day's location
 *    ("Car service", "Car in for repair").
 * Office, remote, work from home, non-working days, leave, holidays and customer calls
 * never count.
 */
const AWAY = new Set(['site', 'training'])

const parts = location => (location || '').split('/').map(p => p.trim()).filter(Boolean)

const CAR = /\b(car|vehicle)\b/
const CAR_WORK = /\b(servic(e|es|ed|ing)|repair(s|ed|ing)?|garage|workshop|mechanic)\b/

/**
 * A part of a day saying the car was in for a service or repair — "Car service", "Car in for
 * repair", "Vehicle being serviced". It has to be about the car: "A7 service training" is a
 * job at a customer's, not the car at the garage.
 */
export const isCarWork = part => { const t = String(part || '').toLowerCase(); return CAR.test(t) && CAR_WORK.test(t) }

/** One day's parts, sorted: the car's service/repair, and the places at a site or on a course. */
function splitDay(day, holiday) {
  const service = []
  const places = []
  for (const p of parts(day?.location)) {
    if (isCarWork(p)) service.push(p)
    else if (AWAY.has(statusOf({ location: p }, holiday))) places.push(p)
  }
  return { service, places }
}

/**
 * The places a day was spent at a site or on a course ("Waikato", "EAS course").
 * `holiday` is the public holiday on that date, if any: what's typed about it
 * ("EASTER", "ANZAC", "Kings birthday NZ") is the holiday, not somewhere visited.
 * A place typed on a holiday still counts — someone was working there.
 */
export function awayPlaces(day, { holiday = '' } = {}) {
  return splitDay(day, holiday).places
}

// ── Auckland ──────────────────────────────────────────────────────────────

/**
 * Places in the Auckland region, so a day there isn't "out of town". A place is in
 * Auckland when any of these appears in it as whole words, in any case — "NSH",
 * "North Shore Hospital", "Middlemore Install", "SX Auckland Surgical". Anything not
 * listed is out of town, so a new city needs no change here; the Out of town page
 * flags the Auckland ones and lets the list be edited.
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
 * The days that belong on the report in the given weeks (from quarterSlices), read from
 * `schedules` ({ [weekStart]: days }): { away, skipped, service }, each in date order and
 * each day in exactly one of them — [{ iso, places }].
 *  - `service`: the car in for a service or repair (that's the reason, whatever else was typed);
 *  - `away`: the places outside Auckland that day;
 *  - `skipped`: days at a site that were all inside Auckland.
 * (reportDays puts them together, with a kind on each.)
 */
export function awayDays(slices, schedules, { aucklandPlaces = AUCKLAND_PLACES } = {}) {
  const local = aucklandMatcher(aucklandPlaces)
  const away = []
  const skipped = []
  const service = []
  for (const s of slices) {
    const days = normalizeSchedule(schedules?.[s.weekStart])
    for (const i of s.indices) {
      const iso = addDaysISO(s.weekStart, i)
      const { service: car, places } = splitDay(days[i], holidayOn(iso))
      const outside = places.filter(p => !local(p))
      if (car.length) service.push({ iso, places: car })
      else if (outside.length) away.push({ iso, places: outside })
      else if (places.length) skipped.push({ iso, places })
    }
  }
  return { away, skipped, service }
}

/**
 * Every day on the report, in date order, each with its kind — 'away' (out of Auckland), 'auckland'
 * (a site inside Auckland, listed so it can be ticked or not) or 'service' (the car in for a
 * service or repair) — from awayDays.
 */
export function reportDays({ away = [], skipped = [], service = [] }) {
  return [
    ...away.map(d => ({ ...d, kind: 'away' })),
    ...skipped.map(d => ({ ...d, kind: 'auckland' })),
    ...service.map(d => ({ ...d, kind: 'service' })),
  ].sort((a, b) => a.iso.localeCompare(b.iso))
}

/**
 * Every weekday of the given weeks as it was read from the schedule and how it was
 * treated, so a day that isn't on the report can be explained: one entry per week,
 * { weekStart, saved, days } — `days` is empty when nothing is saved for that week,
 * otherwise { iso, text, verdict } per weekday in the quarter, where verdict is 'away' (out of
 * Auckland), 'auckland' (a site in Auckland), 'service' (the car in for service or repair),
 * 'no' (anything else — not on the report) or 'blank'.
 */
export function readDays(slices, schedules, { aucklandPlaces = AUCKLAND_PLACES } = {}) {
  const local = aucklandMatcher(aucklandPlaces)
  return slices.map(s => {
    const saved = !!schedules?.[s.weekStart]
    if (!saved) return { weekStart: s.weekStart, saved, days: [] }
    const days = normalizeSchedule(schedules[s.weekStart])
    return {
      weekStart: s.weekStart,
      saved,
      days: s.indices.map(i => {
        const iso = addDaysISO(s.weekStart, i)
        const text = (days[i].location || '').trim()
        const { service, places } = splitDay(days[i], holidayOn(iso))
        const outside = places.filter(p => !local(p))
        return { iso, text, verdict: !text ? 'blank' : service.length ? 'service' : outside.length ? 'away' : places.length ? 'auckland' : 'no' }
      }),
    }
  })
}

/**
 * One saved schedule per week out of everything stored under a person: { schedules, copies }.
 * Normally a week is one document; if there are ever two, the most recently saved is used
 * and `copies` lists those weeks ([[weekStart, [ids…]]]) so it can be pointed out.
 */
export function chooseSchedules(docs) {
  const savedAt = d => d.submittedAt?.toMillis?.() ?? d.importedAt?.toMillis?.() ?? 0
  const best = new Map()
  const ids = new Map()
  for (const d of docs) {
    ids.set(d.weekStart, [...(ids.get(d.weekStart) || []), d.id])
    const have = best.get(d.weekStart)
    if (!have || savedAt(d) >= savedAt(have)) best.set(d.weekStart, d)
  }
  return {
    schedules: Object.fromEntries([...best].map(([weekStart, d]) => [weekStart, d.days || null])),
    copies: [...ids].filter(([, list]) => list.length > 1),
  }
}

const isWeekend = iso => [0, 6].includes(fromISO(iso).getDay())
const nextWeekday = iso => { let d = addDaysISO(iso, 1); while (isWeekend(d)) d = addDaysISO(d, 1); return d }

/**
 * Runs of days in the same place, one record each — the FBT report lists a trip as
 * its place and the dates: [{ kind, key, notes, places, dates }] (days come from reportDays;
 * one with no kind is 'away'). Days join when they are consecutive weekdays (Friday then
 * Monday counts) of the same kind in the same place; a different place, or a day at the
 * office in between, starts a new record.
 */
export function tripsOf(days) {
  const trips = []
  for (const day of days) {
    const kind = day.kind || 'away'
    const notes = day.places.join(', ')
    const key = notes.toLowerCase().replace(/\s+/g, ' ')
    const last = trips.at(-1)
    if (last && last.kind === kind && last.key === key && nextWeekday(last.dates.at(-1)) === day.iso) last.dates.push(day.iso)
    else trips.push({ kind, key, notes, places: day.places, dates: [day.iso] })
  }
  return trips
}

const oneLine = s => String(s || '').replace(/\s+/g, ' ').trim()

/**
 * A record's identity — its first date and place — so what was typed against it is remembered from
 * one visit to the next. Out-of-town and Auckland records share the form they have always had, so
 * notes already saved stay attached; the car's service/repair records are marked.
 */
export const tripId = t => `${t.dates[0]}|${t.kind === 'service' ? 'service|' : ''}${t.key}`

/**
 * The records with the person's changes laid over them: { …trip, id, include, text }.
 * `notes` stays what the schedule said (the place); `text` is what is shown and sent.
 * `edits` is { [id]: { include?: false, notes?: string } }.
 */
export function withEdits(trips, edits = {}) {
  return trips.map(t => {
    const id = tripId(t)
    const e = edits[id] || {}
    return { ...t, id, include: e.include !== false, text: e.notes ?? t.notes }
  })
}

/**
 * `edits` after one change to one record (from withEdits), holding only what differs from the
 * schedule — so a place corrected in the schedule later isn't held back by an old edit.
 */
export function updateEdits(edits, row, patch) {
  const next = { ...edits[row.id], ...patch }
  if (next.include !== false) delete next.include
  if (next.notes === undefined || next.notes === row.notes) delete next.notes
  const rest = { ...edits }
  delete rest[row.id]
  return Object.keys(next).length ? { ...rest, [row.id]: next } : rest
}

/**
 * What goes on the report: the ticked records, each with its kind (which decides the reason line) and its
 * notes on one line, falling back to the schedule's own text if cleared.
 */
export function reportTrips(rows) {
  return rows.filter(r => r.include).map(r => ({ kind: r.kind || 'away', notes: oneLine(r.text) || r.notes, dates: r.dates }))
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
