import { doc, setDoc, deleteDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { scheduleId, weekDates } from './week'
import { holidayOn } from './holidays'
import { excelCellText } from './status'

/**
 * Saves one person's week. `editorUid` is whoever is signed in — when that's
 * not the person themselves (an admin filling in for someone), the schedule
 * is marked needsConfirm so they still get Thursday's reminder and a
 * "check this" note on My week, rather than it silently counting as done.
 * Their own next save clears it.
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
 * Best-effort mirror into the company's existing Excel schedule — never
 * awaited by callers, never shown as an error. `entries` is one
 * { uid, days, comments } per person; admins may send other people's.
 */
export async function syncToExcel(user, weekStart, entries) {
  try {
    const dates = weekDates(weekStart)
    const idToken = await user.getIdToken()
    await fetch('/api/sync-excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({
        weekStart,
        entries: entries.map(e => ({
          uid: e.uid,
          cells: e.days.map((d, i) => excelCellText(d, holidayOn(dates[i]))),
          comments: (e.comments || '').trim(),
        })),
      }),
    })
  } catch (e) {
    console.error('Excel sync failed:', e)
  }
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
export async function writeOnCall(weekStart, person, editorUid) {
  const ref = doc(db, 'oncall', weekStart)
  if (!person) { await deleteDoc(ref); return null }
  const data = { uid: person.uid, displayName: person.displayName || null, updatedBy: editorUid, updatedAt: serverTimestamp() }
  await setDoc(ref, data)
  return data
}
