/**
 * Turns what the Excel says into a plan for what to write — and writes
 * nothing itself. Plain functions with no Firebase, so they can be tested
 * exhaustively and reused by an automatic link later.
 *
 * Two jobs:
 *  1. matchPeople  — which person in the app is each name in the Excel?
 *  2. planImport   — for each person and week, what to add or change.
 *
 * The rule that keeps this safe to run again and again: for every entry we
 * remember what the Excel said last time (`excelBase`). Next time, an app
 * entry that still equals that is untouched by anyone in the app, so a
 * change in the Excel flows in; an app entry that differs was edited in the
 * app, so it's kept. Only when *both* changed is it a genuine conflict, and
 * then the app wins unless asked otherwise.
 */
import { squash } from './excelSchedule.js'
import { normalizeSchedule } from './week.js'
import { shortNames } from './names.js'

// ── Names ─────────────────────────────────────────────────────────────────

const fold = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Lower-case words of a name, accents and (nicknames) removed: "Chang-Chien (Peter) Lin" → ['chang-chien', 'lin']. */
export const nameTokens = s => fold(s).replace(/\([^)]*\)/g, ' ').split(/[^a-z'-]+/).filter(t => /[a-z]/.test(t))

/** Identity of a person in the Excel: their name, folded. */
export const nameKey = s => nameTokens(s).join(' ')

/** The id used for a "not signed in yet" person — the same recipe Admin → Add a person uses. */
export const placeholderId = name => 'pending-' + String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '')

/** Names compared with hyphens and apostrophes ignored: "Jo-ann" = "Joann". */
const squish = s => s.replace(/[-']/g, '')

// Short forms where one isn't simply the start of the other (Mike/Michael, Andy/Andrew…).
// Ones that are (Jess/Jessica, Ben/Benjamin, Sam/Samuel) need no entry here.
const SHORT_FORMS = [
  ['mike', 'michael'], ['mick', 'michael'], ['andy', 'andrew'], ['drew', 'andrew'], ['steve', 'stephen'], ['steve', 'steven'],
  ['dave', 'david'], ['jim', 'james'], ['jimmy', 'james'], ['jamie', 'james'], ['liz', 'elizabeth'], ['beth', 'elizabeth'],
  ['betty', 'elizabeth'], ['tony', 'anthony'], ['bob', 'robert'], ['bobby', 'robert'], ['bill', 'william'], ['kate', 'catherine'],
  ['cathy', 'catherine'], ['jacqui', 'jacqueline'], ['jackie', 'jacqueline'], ['jo', 'joanne'], ['becky', 'rebecca'],
  ['abby', 'abigail'], ['vicky', 'victoria'], ['sue', 'susan'], ['pat', 'patricia'], ['pat', 'patrick'], ['ted', 'edward'],
  ['ed', 'edward'], ['ned', 'edward'], ['nat', 'nathan'], ['gabe', 'gabriel'], ['harry', 'henry'], ['dick', 'richard'],
  ['rick', 'richard'], ['rich', 'richard'],
]

/** Could these be the same first name — equal, one the start of the other (3+ letters), or a known short form? */
function sameFirstName(a, b) {
  if (!a || !b) return false
  if (a === b) return true
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  if (short.length >= 3 && long.startsWith(short)) return true
  return SHORT_FORMS.some(([s, l]) => (s === a && l === b) || (s === b && l === a))
}

function userNameInfo(u) {
  const display = u.displayName || ''
  const legal = nameTokens(display).map(squish)
  const nickname = nameTokens(display.match(/\(([^)]+)\)/)?.[1] || '').map(squish)
  return {
    firsts: [...new Set([legal[0], nickname[0]].filter(Boolean))],
    last: legal.length > 1 ? legal[legal.length - 1] : '',
    explicit: nameKey(u.excelName || ''),
  }
}

/**
 * The people in the Excel across some weeks, once each: [{ key, name, team }].
 * Newest weeks come first so the latest spelling and team win; `hints` (the
 * newest sheet's people) supplies a team for sheets from before the Excel had team labels.
 */
export function excelPeople(weeksPeople, hints = []) {
  const byKey = new Map()
  const newestFirst = [...weeksPeople.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))
  for (const [, people] of newestFirst) {
    for (const p of people) {
      const key = nameKey(p.name)
      if (!key) continue
      const have = byKey.get(key)
      if (!have) byKey.set(key, { key, name: p.name, team: p.team || '' })
      else if (!have.team && p.team) have.team = p.team
    }
  }
  for (const h of hints) {
    const have = byKey.get(nameKey(h.name))
    if (have && !have.team && h.team) have.team = h.team
  }
  return [...byKey.values()]
}

/**
 * Which app person is each Excel name? → Map(key → { status, uid?, how?, candidates? })
 * status: 'matched' | 'ambiguous' (several fit) | 'maybe' (close but not certain) | 'none'.
 * Most specific rule first, and nobody is matched twice:
 *   1. an Excel name an admin already set on the person,
 *   2. first + last name ("Sam Reed"),
 *   3. first name alone ("Sam") — only among people on the same team, so one
 *      Sam is never mistaken for another with the same first name,
 *   4. a close first name ("Mike" / "Michael Fox", "Jess Reed" / "Jessica Reed"):
 *      only ever a *suggestion* for the admin to confirm — a wrong guess would
 *      put someone's whereabouts on the wrong person.
 */
export function matchPeople(people, users) {
  const info = new Map(users.map(u => [u.uid, userNameInfo(u)]))
  const taken = new Set()
  const result = new Map()
  const claim = (p, uid, how) => { taken.add(uid); result.set(p.key, { status: 'matched', uid, how }) }

  for (const p of people) {
    const hits = users.filter(u => !taken.has(u.uid) && info.get(u.uid).explicit === p.key)
    if (hits.length === 1) claim(p, hits[0].uid, 'Excel name')
  }

  for (const p of people) {
    if (result.has(p.key)) continue
    const t = nameTokens(p.name).map(squish)
    if (t.length < 2) continue
    const hits = users.filter(u => !taken.has(u.uid) && info.get(u.uid).last === t[t.length - 1] && info.get(u.uid).firsts.includes(t[0]))
    if (hits.length === 1) claim(p, hits[0].uid, 'full name')
    else if (hits.length > 1) result.set(p.key, { status: 'ambiguous', candidates: hits.map(h => h.uid) })
  }

  for (const p of people) {
    if (result.has(p.key)) continue
    const t = nameTokens(p.name).map(squish)
    if (t.length !== 1) continue
    let hits = users.filter(u => !taken.has(u.uid) && info.get(u.uid).firsts.includes(t[0]))
    if (p.team) hits = hits.filter(u => !u.team || u.team === p.team)
    if (hits.length === 1) claim(p, hits[0].uid, 'first name')
    else if (hits.length > 1) result.set(p.key, { status: 'ambiguous', candidates: hits.map(h => h.uid) })
  }

  for (const p of people) {
    if (result.has(p.key)) continue
    const t = nameTokens(p.name).map(squish)
    if (!t.length) continue
    const last = t.length > 1 ? t[t.length - 1] : ''
    let hits = users.filter(u => !taken.has(u.uid) && info.get(u.uid).firsts.some(f => sameFirstName(f, t[0])))
    if (last) hits = hits.filter(u => info.get(u.uid).last === last) // a full Excel name must agree on the surname
    else if (p.team) hits = hits.filter(u => !u.team || u.team === p.team)
    if (hits.length) result.set(p.key, { status: 'maybe', candidates: hits.map(h => h.uid) })
  }

  for (const p of people) if (!result.has(p.key)) result.set(p.key, { status: 'none' })
  return result
}

/**
 * What to do with each Excel person: Map(key → { kind: 'user', uid } | { kind: 'new', id, displayName, team } | { kind: 'skip' }).
 * Matches go to that person; names nobody in the app has become a new
 * "not signed in yet" person (when `addNew`); unclear ones are skipped until
 * an admin picks. `overrides` (key → 'skip' | 'new' | uid) is what the admin chose.
 * `currentKeys` limits who is added as new to people on the newest sheet.
 */
export function buildMapping(people, matching, users, { addNew = true, overrides = {}, currentKeys = null } = {}) {
  const uids = new Set(users.map(u => u.uid))
  const mapping = new Map()
  for (const p of people) {
    const m = matching.get(p.key) || { status: 'none' }
    const want = overrides[p.key]
    const asNew = () => {
      const id = placeholderId(p.name)
      // The same placeholder from an earlier import — use it rather than overwrite it.
      return uids.has(id) ? { kind: 'user', uid: id } : { kind: 'new', id, displayName: p.name, team: p.team || null }
    }
    if (want === 'skip') mapping.set(p.key, { kind: 'skip' })
    else if (want === 'new') mapping.set(p.key, asNew())
    else if (want && uids.has(want)) mapping.set(p.key, { kind: 'user', uid: want })
    else if (m.status === 'matched') mapping.set(p.key, { kind: 'user', uid: m.uid })
    // `currentKeys` = who is on the newest sheet. Someone who only appears in older
    // weeks has left, so history is imported for them only if they're already in the app.
    else if (m.status === 'none' && addNew && (!currentKeys || currentKeys.has(p.key))) mapping.set(p.key, asNew())
    else mapping.set(p.key, { kind: 'skip' })
  }
  return mapping
}

// ── Merging ───────────────────────────────────────────────────────────────

const same = (a, b) => squash(a).toLowerCase() === squash(b).toLowerCase()

/**
 * One cell (or the week's comment). `excel` is what the Excel says now, `app`
 * what's in the app, `base` what the Excel said at the last import (undefined
 * if never imported). → { value, kind } where kind is one of
 * none | added | same | updated | kept | conflict | replaced.
 */
export function mergeText(excel, app, base, excelWins = false) {
  const e = squash(excel), a = squash(app)
  if (!e) return { value: a, kind: 'none' }                           // never blank the app out because the Excel is blank
  if (!a) return { value: e, kind: 'added' }
  if (same(a, e)) return { value: a, kind: 'same' }
  if (base != null) {
    const b = squash(base)
    if (same(a, b)) return { value: e, kind: 'updated' }                // untouched in the app since last import: take the Excel's change
    if (same(e, b)) return { value: a, kind: 'kept' }                   // Excel hasn't moved; this is the app's own edit
  }
  return excelWins ? { value: e, kind: 'replaced' } : { value: a, kind: 'conflict' }
}

const emptyCounts = () => ({ added: 0, updated: 0, same: 0, kept: 0, conflict: 0, replaced: 0 })

/** Merges one person's week. Returns null when there's nothing to import for them. */
function planPersonWeek({ person, existing, excelWins }) {
  const hasExcelData = person.days.some(Boolean) || person.comment
  if (!hasExcelData) return null

  const appDays = existing ? normalizeSchedule(existing.days) : null
  const base = existing?.excelBase || null
  const counts = emptyCounts()
  const conflicts = []
  const days = []
  const baseDays = []
  let contentChanged = !existing

  for (let i = 0; i < 5; i++) {
    const merged = mergeText(person.days[i], appDays?.[i]?.location, base?.days?.[i], excelWins)
    if (merged.kind in counts) counts[merged.kind]++
    if (merged.kind === 'added' || merged.kind === 'updated' || merged.kind === 'replaced') contentChanged = true
    if (merged.kind === 'conflict') conflicts.push({ day: i, app: squash(appDays?.[i]?.location), excel: squash(person.days[i]) })
    days.push({ ...(appDays?.[i] || { onCall: false }), location: merged.value })
    baseDays.push(squash(person.days[i]) || squash(base?.days?.[i]))
  }

  const mergedComment = mergeText(person.comment, existing?.comments, base?.comments, excelWins)
  if (mergedComment.kind === 'added' || mergedComment.kind === 'updated' || mergedComment.kind === 'replaced') contentChanged = true
  const newBase = { days: baseDays, comments: squash(person.comment) || squash(base?.comments) }
  const baseChanged = !base || baseDays.some((d, i) => !same(d, base.days?.[i])) || !same(newBase.comments, base.comments)

  return { days, comments: mergedComment.value, base: newBase, counts, conflicts, contentChanged, baseChanged, isNew: !existing }
}

/**
 * The whole import, as data.
 *  weeks:          Map(weekStart → people read from that week's sheet)
 *  selected:       the weekStarts to import
 *  mapping:        from buildMapping
 *  existing:       Map(`${weekStart}_${uid}` → the schedule already in the app)
 *  existingOnCall: Map(weekStart → on-call doc already in the app)
 * → { schedules, onCall, newPeople, userUpdates, weekRows, conflicts, stats, warnings }
 */
export function planImport({ weeks, selected, mapping, users, existing, existingOnCall, excelWins = false }) {
  const plan = { schedules: [], onCall: [], newPeople: new Map(), userUpdates: new Map(), weekRows: [], conflicts: [], stats: { ...emptyCounts(), weeks: 0, people: 0, writes: 0 }, warnings: [] }
  const visibleName = shortNames(users)
  const usersById = new Map(users.map(u => [u.uid, u]))
  const peopleSeen = new Set()

  for (const weekStart of [...selected].sort()) {
    const people = weeks.get(weekStart) || []
    const row = { weekStart, people: 0, ...emptyCounts(), writes: 0 }
    const usedThisWeek = new Set()

    for (const p of people) {
      const key = nameKey(p.name)
      const target = mapping.get(key)
      if (!target || target.kind === 'skip') continue
      const uid = target.kind === 'user' ? target.uid : target.id
      if (usedThisWeek.has(uid)) { plan.warnings.push(`Two rows for the same person in the week of ${weekStart} — the first was used.`); continue }

      const id = `${weekStart}_${uid}`
      const item = planPersonWeek({ person: p, existing: existing.get(id), excelWins })
      if (!item) continue
      usedThisWeek.add(uid)
      peopleSeen.add(uid)
      row.people++
      for (const k of Object.keys(emptyCounts())) { row[k] += item.counts[k]; plan.stats[k] += item.counts[k] }

      const user = usersById.get(uid)
      const team = user?.team || (target.kind === 'new' ? target.team : null) || p.team || null
      if (target.kind === 'new') plan.newPeople.set(uid, { id: uid, displayName: target.displayName, team: target.team, excelName: p.name })
      else if (user && visibleName.get(uid) && nameKey(visibleName.get(uid)) !== key && nameKey(user.excelName || '') !== key) {
        plan.userUpdates.set(uid, { excelName: p.name })
      }
      for (const c of item.conflicts) plan.conflicts.push({ weekStart, uid, name: p.name, ...c })

      if (item.contentChanged || item.baseChanged) {
        row.writes++
        plan.schedules.push({
          id, weekStart, uid, team,
          displayName: user?.displayName || target.displayName || p.name,
          email: user?.email || null,
          ...item,
        })
      }
      if (p.onCall && !existingOnCall.get(weekStart)?.uid && !plan.onCall.some(o => o.weekStart === weekStart)) {
        plan.onCall.push({ weekStart, uid, displayName: user?.displayName || target.displayName || p.name })
      }
    }
    plan.weekRows.push(row)
  }

  plan.stats.weeks = plan.weekRows.filter(r => r.people).length
  plan.stats.people = peopleSeen.size
  plan.stats.writes = plan.schedules.length
  return plan
}
