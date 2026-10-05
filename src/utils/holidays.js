import { toISO } from './week.js'

/**
 * New Zealand public holidays, worked out in code so nobody has to maintain
 * a list. National holidays follow the Holidays Act's Mondayisation rules;
 * Auckland Anniversary is included too since that's where the office is — it
 * only ever fills an otherwise-empty day, so anyone working elsewhere that
 * day just enters where they are as normal.
 */

// Matariki moves with the stars, so it's set in law rather than by a rule —
// dates from the Te Kāhui o Matariki Public Holiday Act 2022 schedule.
const MATARIKI = {
  2022: '06-24', 2023: '07-14', 2024: '06-28', 2025: '06-20', 2026: '07-10',
  2027: '06-25', 2028: '07-14', 2029: '07-06', 2030: '06-21', 2031: '07-11', 2032: '07-02',
}

const isWeekend = d => d.getDay() === 0 || d.getDay() === 6

/** Easter Sunday (Gregorian) — anonymous/Meeus algorithm. */
function easterSunday(year) {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month - 1, day)
}

/** The nth Monday of a month (month is 0-based). */
function nthMonday(year, month, n) {
  const d = new Date(year, month, 1)
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1)
  d.setDate(d.getDate() + (n - 1) * 7)
  return d
}

function nextWeekday(date, taken) {
  const d = new Date(date)
  do { d.setDate(d.getDate() + 1) } while (isWeekend(d) || taken.has(toISO(d)))
  return d
}

/**
 * Christmas/Boxing Day and New Year/2 January work as pairs: a day falling
 * on a weekend moves to the next weekday that isn't already a holiday.
 */
function addPair(out, first, firstName, second, secondName) {
  const days = [[first, firstName], [second, secondName]]
  const taken = new Set()
  for (const [d, name] of days) {
    if (!isWeekend(d)) { out.set(toISO(d), name); taken.add(toISO(d)) }
  }
  for (const [d, name] of days) {
    if (isWeekend(d)) {
      const observed = nextWeekday(d, taken)
      out.set(toISO(observed), `${name} (observed)`)
      taken.add(toISO(observed))
    }
  }
}

/** A single holiday that moves to Monday when it lands on a weekend. */
function addMondayised(out, date, name) {
  if (!isWeekend(date)) { out.set(toISO(date), name); return }
  const d = new Date(date)
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1)
  out.set(toISO(d), `${name} (observed)`)
}

/** Monday closest to 29 January. */
function aucklandAnniversary(year) {
  const d = new Date(year, 0, 29)
  const dow = d.getDay()
  const back = (dow + 6) % 7   // days back to the previous Monday
  const forward = (8 - dow) % 7 // days on to the next Monday
  d.setDate(d.getDate() + (back <= forward ? -back : forward))
  return d
}

const cache = new Map()

/** Map of YYYY-MM-DD → holiday name for every public holiday in that year. */
export function holidaysForYear(year) {
  if (cache.has(year)) return cache.get(year)
  const out = new Map()
  addPair(out, new Date(year, 0, 1), "New Year's Day", new Date(year, 0, 2), 'Day after New Year')
  out.set(toISO(aucklandAnniversary(year)), 'Auckland Anniversary')
  addMondayised(out, new Date(year, 1, 6), 'Waitangi Day')
  const easter = easterSunday(year)
  const goodFriday = new Date(easter); goodFriday.setDate(easter.getDate() - 2)
  const easterMonday = new Date(easter); easterMonday.setDate(easter.getDate() + 1)
  out.set(toISO(goodFriday), 'Good Friday')
  out.set(toISO(easterMonday), 'Easter Monday')
  addMondayised(out, new Date(year, 3, 25), 'ANZAC Day')
  out.set(toISO(nthMonday(year, 5, 1)), "King's Birthday")
  if (MATARIKI[year]) out.set(`${year}-${MATARIKI[year]}`, 'Matariki')
  out.set(toISO(nthMonday(year, 9, 4)), 'Labour Day')
  addPair(out, new Date(year, 11, 25), 'Christmas Day', new Date(year, 11, 26), 'Boxing Day')
  cache.set(year, out)
  return out
}

/** Holiday name for a YYYY-MM-DD date, or '' when it's an ordinary day. */
export function holidayOn(iso) {
  return holidaysForYear(Number(iso.slice(0, 4))).get(iso) || ''
}

/**
 * How people actually type each holiday into a day — "EASTER", "ANZAC", "Kings
 * birthday NZ", "PH" — keyed by the names above. Only ever checked on the date of
 * that holiday, so a word that is also a place ("Waitangi", "Labour ward") stays a
 * place on every other day, and on the holiday itself a ward is still a ward.
 */
const TYPED_AS = {
  "New Year's Day": /new\s*year/,
  'Day after New Year': /new\s*year|\b2(nd)?\s*jan|\bjan(uary)?\s*2(nd)?\b|day after/,
  'Auckland Anniversary': /anniversary/,
  'Waitangi Day': /waitangi/,
  'Good Friday': /good\s*friday|easter/,
  'Easter Monday': /easter/,
  'ANZAC Day': /anzac/,
  "King's Birthday": /^(king|queen)['’]?s?$|(king|queen)['’]?s?\s+b(irth)?day/,
  Matariki: /matariki/,
  'Labour Day': /^labou?r$|labou?r\s*(day|weekend)/,
  'Christmas Day': /christmas|xmas/,
  'Boxing Day': /boxing/,
}
/** "Holiday", "Pub hol", "PH", "Stat" — on a holiday's date these can only mean that holiday. */
const ANY_HOLIDAY = /\bholiday\b|\bhol\b|\bph\b|\bstat\b/

/** Whether what's typed in a day (any case) says it's the public holiday falling on that date. */
export function namesHoliday(text, holidayName) {
  const t = String(text || '').trim().toLowerCase()
  if (!holidayName || !t) return false
  return ANY_HOLIDAY.test(t) || !!TYPED_AS[holidayName.replace(/ \(observed\)$/, '')]?.test(t)
}
