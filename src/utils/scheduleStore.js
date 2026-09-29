import { doc, getDoc, setDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { scheduleId, normalizeSchedule, normalizeCalls, weekdaysInRange } from './week'
import { holidayOn } from './holidays'

/**
 * Saves one person's week. `editorUid` is whoever is signed in — when that's
 * not the person themselves (an admin filling in for someone), the schedule
 * is marked needsConfirm so they still get Thursday's reminder and a
 * "check this" note on My week, rather than it silently counting as done.
 * Their own next save clears it. The Excel copy happens separately: a
 * GitHub Action picks up anything saved since its last run (scripts/sync-excel.mjs).
 */
export async function writeSchedule({ person, weekStart, days, comments, editorUid, existing, extra = {} }) {
  const own = person.uid === editorUid
  const data = {
    uid:          person.uid,
    displayName:  person.displayName || null,
    email:        person.email || null,
    team:         person.team || null,
    weekStart,
    days:         days.map(d => ({ location: (d.location || '').trim(), onCall: !!d.onCall })),
    comments:     (comments || '').trim(),
    submittedAt:  serverTimestamp(),
    needsConfirm: own ? false : (existing ? !!existing.needsConfirm : true),
    ...(own ? {} : { editedBy: editorUid }),
    ...extra,
  }
  // merge keeps fields this doesn't know about (e.g. importedFromExcel);
  // days is an array, so it's still replaced wholesale, not merged.
  await setDoc(doc(db, 'schedules', scheduleId(weekStart, person.uid)), data, { merge: true })
  return { ...data, submittedAt: new Date() }
}

/**
 * Books one person's leave (or training) across a date range — every weekday
 * from..to gets the type as its location, week by week. Weekends and public
 * holidays are skipped, and every other day is left exactly as it was.
 * Returns one { weekStart, days, comments, saved } per week touched, so the
 * caller can update what's on screen.
 */
export async function writeLeaveRange({ person, from, to, type, editorUid }) {
  const byWeek = new Map()
  for (const { weekStart, dayIdx, iso } of weekdaysInRange(from, to)) {
    if (holidayOn(iso)) continue
    byWeek.set(weekStart, [...(byWeek.get(weekStart) || []), dayIdx])
  }

  const written = []
  for (const [weekStart, idxs] of byWeek) {
    const snap = await getDoc(doc(db, 'schedules', scheduleId(weekStart, person.uid)))
    const existing = snap.exists() ? snap.data() : null
    const days = normalizeSchedule(existing?.days).map((d, i) => (idxs.includes(i) ? { location: type, onCall: false } : d))
    const comments = existing?.comments || ''
    const saved = await writeSchedule({ person, weekStart, days, comments, editorUid, existing })
    written.push({ weekStart, days, comments, saved })
  }
  return written
}

/**
 * Anything typed that isn't a known location yet becomes a shared
 * suggestion for everyone (and shows up in Admin → Locations). Failures
 * are swallowed — never let this block saving the schedule itself.
 */
export async function addNewLocations(names, known) {
  const isKnown = n => known.some(k => k.toLowerCase() === n.toLowerCase())
  const fresh = [...new Set(names.map(n => (n || '').trim()).filter(Boolean))].filter(n => !isKnown(n))
  if (!fresh.length) return []
  try {
    await Promise.all(fresh.map(name => addDoc(collection(db, 'locations'), {
      name, order: Date.now(), active: true, createdAt: serverTimestamp(),
    })))
  } catch (e) {
    console.error('Failed to save new location(s):', e)
  }
  return fresh
}

/** Sets (or, with person = null, clears) the weekly on-call engineer. */
export async function writeOnCall(weekStart, person, editorUid, existing) {
  return patchOnCall(weekStart, existing, {
    uid: person?.uid || null,
    displayName: person?.displayName || null,
  }, editorUid)
}

/**
 * Sets (or, with person = null, clears) who covers customer calls on one
 * weekday of a week. Cover lives on the week's on-call doc rather than on
 * each person's own schedule, so it's rostered in one place.
 */
export async function writeCallsCover(weekStart, dayIdx, person, editorUid, existing) {
  const calls = normalizeCalls(existing?.calls)
  calls[dayIdx] = person?.uid || ''
  return patchOnCall(weekStart, existing, { calls }, editorUid)
}

/**
 * One week's roster doc holds both the on-call engineer and the five days of
 * customer-calls cover, so every write merges into what's already there and
 * hands the whole doc back for the caller to cache.
 */
async function patchOnCall(weekStart, existing, change, editorUid) {
  const data = {
    uid: null,
    displayName: null,
    ...existing,
    calls: normalizeCalls(existing?.calls),
    ...change,
    updatedBy: editorUid,
    updatedAt: serverTimestamp(),
  }
  await setDoc(doc(db, 'oncall', weekStart), data, { merge: true })
  return { ...data, updatedAt: new Date() }
}
