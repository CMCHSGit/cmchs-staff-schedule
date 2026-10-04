import { collection, doc, getDocs, query, where, writeBatch, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'

// Firestore's `in` takes up to 30 values; a batch up to 500 writes.
const WEEKS_PER_QUERY = 30
const WRITES_PER_BATCH = 400

/** What the app already holds for these weeks: { schedules: Map(id → doc), onCall: Map(weekStart → doc) }. */
export async function loadExisting(weekStarts) {
  const schedules = new Map()
  for (let i = 0; i < weekStarts.length; i += WEEKS_PER_QUERY) {
    const snap = await getDocs(query(collection(db, 'schedules'), where('weekStart', 'in', weekStarts.slice(i, i + WEEKS_PER_QUERY))))
    snap.docs.forEach(d => schedules.set(d.id, d.data()))
  }
  const onCall = new Map((await getDocs(collection(db, 'oncall'))).docs.map(d => [d.id, d.data()]))
  return { schedules, onCall }
}

/**
 * Saves a plan from planImport. Everything is a merge — nothing is ever
 * deleted — and the writes are idempotent (the plan records what the Excel
 * said, so running the import again finds nothing left to do), so if it
 * stops part-way just run it again.
 *
 * Imported entries deliberately don't touch `submittedAt`: that means "saved
 * in the app", and the Excel copy job (scripts/sync-excel.mjs) uses it to
 * find what to write *to* the Excel — importing shouldn't echo straight back.
 */
export async function applyImportPlan(plan, { editorUid = null, onProgress } = {}) {
  const ops = []

  for (const person of plan.newPeople.values()) {
    ops.push({
      ref: doc(db, 'users', person.id),
      data: { displayName: person.displayName, team: person.team, role: 'user', excelName: person.excelName, pending: true, importedFromExcel: true, createdAt: serverTimestamp() },
    })
  }
  for (const [uid, update] of plan.userUpdates) ops.push({ ref: doc(db, 'users', uid), data: update, merge: true })

  for (const s of plan.schedules) {
    const excelBase = { ...s.base, at: serverTimestamp() }
    const days = s.days.map(d => ({ location: d.location, onCall: !!d.onCall }))
    let data
    if (s.isNew) {
      data = { uid: s.uid, displayName: s.displayName, email: s.email, team: s.team, weekStart: s.weekStart, days, comments: s.comments, needsConfirm: false, importedFromExcel: true, importedAt: serverTimestamp(), excelBase }
    } else if (s.contentChanged) {
      // An existing week keeps its owner, team and "needs checking" flag.
      data = { days, comments: s.comments, importedFromExcel: true, importedAt: serverTimestamp(), excelBase }
    } else {
      data = { excelBase } // only remembering what the Excel says, for next time
    }
    ops.push({ ref: doc(db, 'schedules', s.id), data, merge: true })
  }

  for (const o of plan.onCall) {
    // `calls` (customer-calls cover) is left alone; a roster doc without it reads as no cover.
    ops.push({ ref: doc(db, 'oncall', o.weekStart), data: { uid: o.uid, displayName: o.displayName, updatedBy: editorUid, updatedAt: serverTimestamp(), importedFromExcel: true }, merge: true })
  }

  let done = 0
  for (let i = 0; i < ops.length; i += WRITES_PER_BATCH) {
    const batch = writeBatch(db)
    for (const op of ops.slice(i, i + WRITES_PER_BATCH)) {
      if (op.merge) batch.set(op.ref, op.data, { merge: true })
      else batch.set(op.ref, op.data)
    }
    await batch.commit()
    done = Math.min(ops.length, i + WRITES_PER_BATCH)
    onProgress?.(done, ops.length)
  }
  return { writes: done }
}
