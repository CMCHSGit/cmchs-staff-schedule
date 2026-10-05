/**
 * What a schedule entry *means* — worked out from the text people type, the
 * same way the Excel schedule works (type a location, the colour follows).
 * Keeps entry to one field instead of a status picker plus a location box.
 *
 * Colours are the Excel schedule's own fills, as carried into the v2 design —
 * they carry meaning for logistics, so keep them exact rather than
 * re-tinting them to the brand palette — in dark mode too. Only the plain
 * (white in Excel) statuses follow the theme, via PLAIN.
 */
import { namesHoliday } from './holidays.js'

export const PLAIN = 'var(--cell-plain)'
/** Text on an Excel fill is always dark, whatever the theme. */
export const INK = '#1d1d1d'

export const STATUS = {
  calls:    { label: 'Customer Calls',  bg: '#FFFF00' },
  office:   { label: 'Cass Office',     bg: PLAIN },
  site:     { label: 'On site',         bg: PLAIN },
  remote:   { label: 'Remote Support',  bg: PLAIN },
  wfh:      { label: 'Work from Home',  bg: PLAIN },
  training: { label: 'Training',        bg: '#e9f2da' },
  leave:    { label: 'Leave',           bg: '#FFC000' },
  nwd:      { label: 'Non-Working Day', bg: '#D9D9D9' },
  holiday:  { label: 'Public Holiday',  bg: '#dbd7ed' },
}

/** Name-cell fill for whoever is on the weekly on-call roster ("Sam - OnCall" in Excel). */
export const ONCALL_BG = '#FF7C80'

/** What the Leave calendar offers when booking someone's time away — each one
 * reads back as Leave (or Training) via statusOf. */
export const LEAVE_TYPES = ['Annual Leave', 'Sick Leave', 'Lieu Day', 'Bereavement Leave', 'Parental Leave', 'Unpaid Leave', 'Training']

/** Order the Day view lists groups in. */
export const STATUS_ORDER = ['calls', 'office', 'site', 'remote', 'wfh', 'training', 'leave', 'nwd', 'holiday']

export const LEGEND = [
  { label: 'Office / site / remote / WFH', bg: PLAIN },
  { label: 'Customer Calls', bg: STATUS.calls.bg },
  { label: 'On call (weekly)', bg: ONCALL_BG },
  { label: 'Leave', bg: STATUS.leave.bg },
  { label: 'Non-Working Day', bg: STATUS.nwd.bg },
  { label: 'Public Holiday', bg: STATUS.holiday.bg },
  { label: 'Training', bg: STATUS.training.bg },
]

/**
 * A public holiday written into a day rather than left to the app — "Public Holiday",
 * or by name or shorthand: "Matariki Day", "Good Friday", "Kings birthday NZ", "EASTER".
 * The Excel is full of them, and without this they'd read as a place to visit.
 * The phrases in HOLIDAY_PHRASE can't be a place, so they count wherever they appear;
 * HOLIDAY_ALONE words only when they're the whole entry. A word that is also a place
 * ("Waitangi", "Labour ward", "Starship 20th Anniversary") is a holiday only on that
 * holiday's own date — pass `holidayName` for that (see namesHoliday).
 */
const HOLIDAY_PHRASE = /public holiday|stat(utory)? holiday|waitangi day|anzac day|labou?r day|boxing day|christmas day|xmas day|new year['’]?s day|day after new year|good friday|\beaster\b|(king|queen)['’]?s birthday|anniversary day|(canterbury|christchurch) show day|(auckland|wellington|northland|taranaki|hawke['’]?s bay|nelson|marlborough|canterbury|westland|otago|southland|chatham( islands)?) anniversary/
const HOLIDAY_ALONE = /^((matariki|anzac|christmas|xmas|new year['’]?s?)( day)?|show day|ph|stat|pub(lic)? hol)( \(observed\))?$/

/**
 * Status key for a day's text + customer-calls flag, or null for an empty day.
 * `holidayName` is the public holiday falling on that date, when the caller knows it.
 */
export function statusOf(day, holidayName = '') {
  const t = (day?.location || '').trim().toLowerCase()
  if (/\bleave\b|\blieu\b|\bsick\b|bereavement/.test(t)) return 'leave'
  if (/non[\s-]?working|\bnwd\b|\bday off\b/.test(t)) return 'nwd'
  if (HOLIDAY_PHRASE.test(t) || HOLIDAY_ALONE.test(t) || namesHoliday(t, holidayName)) return 'holiday'
  if (/\bholiday\b/.test(t)) return 'leave' // "on holiday" = annual leave
  // `onCall` is the customer-calls flag — set on the on-call roster, folded
  // into the day by daysWithCalls() before anything here sees it.
  if (day?.onCall || /customer call|\bon[\s-]?call\b/.test(t)) return 'calls'
  if (!t) return null
  if (/\btraining\b/.test(t)) return 'training'
  if (/\bremote\b/.test(t)) return 'remote'
  if (/work(ing)? from home|\bwfh\b/.test(t)) return 'wfh'
  if (/cass office|^office$|^cass$/.test(t)) return 'office'
  return 'site'
}

/**
 * Everything a view needs to show one person's day: the text, what it means,
 * and its fill. An empty day on a public holiday shows the holiday.
 */
export function describeDay(day, holidayName = '') {
  const location = (day?.location || '').trim()
  const calls = !!day?.onCall
  let text = location
  if (calls && !/customer call/i.test(location)) text = location ? `${location} / Customer Calls` : 'Customer Calls'
  let status = statusOf(day, holidayName)
  if (!status && holidayName) { status = 'holiday'; text = holidayName }
  const noteSource = status === 'holiday' && !location ? holidayName : location
  return {
    text,
    status,
    calls,
    empty: !status,
    bg: status ? STATUS[status].bg : PLAIN,
    fg: status && STATUS[status].bg !== PLAIN ? INK : 'var(--text-strong)',
    filled: !!status && STATUS[status].bg !== PLAIN,
    // Anything more specific than the status's own name, e.g. "Tauranga".
    note: status && noteSource && simplify(noteSource) !== simplify(STATUS[status].label) ? noteSource : '',
  }
}

const simplify = s => s.toLowerCase().replace(/[^a-z]/g, '').replace(/s$/, '')

/**
 * The same day with any customer-calls claim taken off it — the flag, and the
 * "… / Customer Calls" the Excel writes into the text. Setting cover on the
 * on-call roster uses this on everyone else's entry for that day, so the
 * roster stays the one place a day's cover comes from.
 */
export function withoutCalls(day) {
  const location = (day?.location || '')
    .split('/')
    .map(p => p.trim())
    .filter(p => p && !/customer call|on[ -]?call/i.test(p))
    .join(' / ')
  return { ...day, location, onCall: false }
}

/** What goes into the Excel cell for a day — same text Team week shows. */
export function excelCellText(day, holidayName = '') {
  return describeDay(day, holidayName).text
}
