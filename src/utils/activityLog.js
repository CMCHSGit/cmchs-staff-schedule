import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'

/**
 * "Who changed what" — one line per save, read back on Admin → Activity log.
 * Fire-and-forget, same as the Excel mirror: a logging failure (offline, the
 * rules not yet published) never blocks or fails the action it's logging,
 * it just means that one action goes unrecorded.
 */
export async function logActivity(editor, summary) {
  try {
    await addDoc(collection(db, 'activity'), {
      uid: editor?.uid || null,
      name: editor?.displayName || editor?.email || 'Someone',
      email: editor?.email || null,
      summary,
      at: serverTimestamp(),
    })
  } catch (e) {
    console.error('Activity log failed:', e)
  }
}
