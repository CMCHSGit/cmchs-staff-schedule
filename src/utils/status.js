/**
 * What a schedule entry *means* — worked out from the text people type, the
 * same way the Excel schedule works (type a location, the colour follows).
 * Keeps entry to one field instead of a status picker plus a location box.
 *
 * Colours are the Excel schedule's own fills, as carried into the v2 design —
 * they carry meaning for logistics, so keep them exact rather than
 * re-tinting them to the brand palette.
 */
export const STATUS = {
  calls:    { label: 'Customer Calls',  bg: '#FFFF00' },
  office:   { label: 'Cass Office',     bg: '#ffffff' },
  site:     { label: 'On site',         bg: '#ffffff' },
  remote:   { label: 'Remote Support',  bg: '#ffffff' },
  wfh:      { label: 'Work from Home',  bg: '#ffffff' },
  training: { label: 'Training',        bg: '#e9f2da' },
  leave:    { label: 'Leave',           bg: '#FFC000' },
  nwd:      { label: 'Non-Working Day', bg: '#D9D9D9' },
  holiday:  { label: 'Public Holiday',  bg: '#dbd7ed' },
}

/** Name-cell fill for whoever is on the weekly on-call roster ("Sam - OnCall" in Excel). */
export const ONCALL_BG = '#FF7C80'

/** Order the Day view lists groups in. */
export const STATUS_ORDER = ['calls', 'office', 'site', 'remote', 'wfh', 'training', 'leave', 'nwd', 'holiday']

export const LEGEND = [
  { label: 'Office / site / remote / WFH', bg: '#ffffff' },
  { label: 'Customer Calls', bg: STATUS.calls.bg },
  { label: 'On call (weekly)', bg: ONCALL_BG },
  { label: 'Leave', bg: STATUS.leave.bg },
  { label: 'Non-Working Day', bg: STATUS.nwd.bg },
  { label: 'Public Holiday', bg: STATUS.holiday.bg },
  { label: 'Training', bg: STATUS.training.bg },
]

/** Status key for a day's text + customer-calls flag, or null for an empty day. */
export function statusOf(day) {
  const t = (day?.location || '').trim().toLowerCase()
  if (/\bleave\b|\blieu\b|\bsick\b|bereavement/.test(t)) return 'leave'
  if (/non[\s-]?working|\bnwd\b|\bday off\b/.test(t)) return 'nwd'
  if (/public holiday|stat(utory)? holiday/.test(t)) return 'holiday'
  if (/\bholiday\b/.test(t)) return 'leave' // "on holiday" = annual leave
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
  let status = statusOf(day)
  if (!status && holidayName) { status = 'holiday'; text = holidayName }
  const noteSource = status === 'holiday' && !location ? holidayName : location
  return {
    text,
    status,
    calls,
    empty: !status,
    bg: status ? STATUS[status].bg : '#ffffff',
    // Anything more specific than the status's own name, e.g. "Tauranga".
    note: status && noteSource && simplify(noteSource) !== simplify(STATUS[status].label) ? noteSource : '',
  }
}

const simplify = s => s.toLowerCase().replace(/[^a-z]/g, '').replace(/s$/, '')

/** What goes into the Excel cell for a day — same text Team week shows. */
export function excelCellText(day, holidayName = '') {
  return describeDay(day, holidayName).text
}
