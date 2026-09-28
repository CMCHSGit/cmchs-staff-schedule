import { useCallback, useEffect, useState } from 'react'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '../firebase'

/** Everyone on the roster, including admin-imported people who haven't signed in yet. */
export function useUsers() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    getDocs(collection(db, 'users'))
      .then(snap => { if (!cancelled) setUsers(snap.docs.map(d => ({ uid: d.id, ...d.data() }))) })
      .catch(e => console.error('Failed to load people:', e))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  return { users, loading }
}

/**
 * Schedules for a set of weeks, as { [weekStart]: { [uid]: schedule } }.
 * `patch` updates one schedule in place after a save, without a reload.
 */
export function useSchedules(weekStarts) {
  const key = weekStarts.join(',')
  const [byWeek, setByWeek] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const weeks = key ? key.split(',') : []
    if (!weeks.length) { setByWeek({}); setLoading(false); return }
    setLoading(true)
    // Firestore's `in` takes up to 30 values — every caller asks for far fewer.
    getDocs(query(collection(db, 'schedules'), where('weekStart', 'in', weeks)))
      .then(snap => {
        if (cancelled) return
        const next = Object.fromEntries(weeks.map(w => [w, {}]))
        for (const d of snap.docs) {
          const s = d.data()
          if (next[s.weekStart]) next[s.weekStart][s.uid] = { id: d.id, ...s }
        }
        setByWeek(next)
      })
      .catch(e => console.error('Failed to load schedules:', e))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [key])

  const patch = useCallback((weekStart, uid, schedule) => {
    setByWeek(prev => ({ ...prev, [weekStart]: { ...(prev[weekStart] || {}), [uid]: schedule } }))
  }, [])

  return { byWeek, loading, patch }
}

/**
 * The weekly on-call roster for a set of weeks, as { [weekStart]: { uid, displayName } }.
 * `blocked` is true when the database rules don't allow reading it yet
 * (firestore.rules not published) — views say so instead of looking empty.
 */
export function useOnCall(weekStarts) {
  const key = weekStarts.join(',')
  const [byWeek, setByWeek] = useState({})
  const [blocked, setBlocked] = useState(false)

  useEffect(() => {
    let cancelled = false
    const weeks = key ? key.split(',') : []
    Promise.all(weeks.map(w => getDoc(doc(db, 'oncall', w))))
      .then(snaps => {
        if (cancelled) return
        setBlocked(false)
        setByWeek(Object.fromEntries(snaps.filter(s => s.exists()).map(s => [s.id, s.data()])))
      })
      .catch(e => {
        if (cancelled) return
        if (e.code === 'permission-denied') setBlocked(true)
        else console.error('Failed to load on-call roster:', e)
      })
    return () => { cancelled = true }
  }, [key])

  const set = useCallback((weekStart, value) => {
    setByWeek(prev => {
      const next = { ...prev }
      if (value) next[weekStart] = value
      else delete next[weekStart]
      return next
    })
  }, [])

  return { byWeek, blocked, set }
}

/** Shared suggestions for the location picker (Admin → Locations plus anything typed before). */
export function useLocations() {
  const [locations, setLocations] = useState([])

  useEffect(() => {
    // Sorted client-side rather than via orderBy('order') — combining an
    // equality filter with a sort on a different field needs a composite
    // Firestore index, which doesn't exist here.
    getDocs(query(collection(db, 'locations'), where('active', '==', true)))
      .then(snap => setLocations(snap.docs.map(d => d.data()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(d => d.name)))
      .catch(e => console.error('Failed to load locations:', e))
  }, [])

  return [locations, setLocations]
}
