import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc, setDoc, deleteDoc, collection, query, where, getDocs, serverTimestamp } from 'firebase/firestore'
import { auth, db, microsoftProvider } from '../firebase'

/** first.last@ pattern guesses for a full "First Last" name — company uses both domains. */
function guessedEmails(fullName) {
  const parts = fullName.trim().toLowerCase().split(/\s+/)
  if (parts.length < 2) return []
  const key = `${parts[0]}.${parts[parts.length - 1]}`
  return [`${key}@cass.co.nz`, `${key}@chsnz.co.nz`]
}

/**
 * Copies any schedules saved under a pending placeholder's made-up id onto
 * the real uid claiming it, so admin-backfilled history doesn't become
 * orphaned the moment the placeholder is deleted. The old copies are left
 * in place rather than deleted (deleting them needs admin rights, which a
 * brand-new sign-in doesn't have) — harmless, since nothing ever looks
 * them up again once no user document references that placeholder id.
 */
async function transferSchedules(pendingId, realUid) {
  const snap = await getDocs(query(collection(db, 'schedules'), where('uid', '==', pendingId)))
  for (const scheduleDoc of snap.docs) {
    const newId = scheduleDoc.id.replace(pendingId, realUid)
    await setDoc(doc(db, 'schedules', newId), { ...scheduleDoc.data(), uid: realUid })
  }
}

/**
 * Admin → Users can bulk-create "pending" placeholder profiles (team,
 * excelName) for staff who haven't signed in yet, keyed by a made-up id
 * rather than their eventual real uid (which doesn't exist until they do).
 * On an actual first sign-in, adopt one of those placeholders — preferring
 * an email match (reliable even for two pending people sharing a first
 * name, e.g. two "Mark"s, as long as the pending record has a full name to
 * guess an email from) and falling back to first-name matching otherwise,
 * only when exactly one pending record shares that name. A genuinely
 * ambiguous case (shared first name, no full name to disambiguate with) is
 * left alone rather than guessed at — an admin sorts it out by hand, since
 * a wrong auto-merge silently hands someone the wrong team assignment.
 */
async function claimPendingProfile(firebaseUser) {
  const email = (firebaseUser.email || '').toLowerCase()
  const firstName = (firebaseUser.displayName || '').trim().split(/\s+/)[0]?.toLowerCase()

  const snap = await getDocs(query(collection(db, 'users'), where('pending', '==', true)))
  const pendingDocs = snap.docs

  let claimed = null
  if (email) {
    const emailMatches = pendingDocs.filter(d => guessedEmails(d.data().displayName || '').includes(email))
    if (emailMatches.length === 1) claimed = emailMatches[0]
  }
  if (!claimed && firstName) {
    const nameMatches = pendingDocs.filter(d => {
      const pendingFirst = (d.data().displayName || '').trim().split(/\s+/)[0]?.toLowerCase()
      return pendingFirst === firstName
    })
    if (nameMatches.length === 1) claimed = nameMatches[0]
  }
  if (!claimed) return null

  const data = claimed.data()
  await transferSchedules(claimed.id, firebaseUser.uid)
  await deleteDoc(claimed.ref)
  return data
}

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user,         setUser]         = useState(undefined) // undefined = loading auth
  const [profile,      setProfile]      = useState(null)
  const [profileReady, setProfileReady] = useState(false)   // false until Firestore profile loaded
  const loadedUidRef = useRef(null) // whose profile we've already fetched this session

  useEffect(() => {
    return onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        loadedUidRef.current = null
        setUser(null)
        setProfile(null)
        setProfileReady(true)
        return
      }

      setUser(firebaseUser)

      // onAuthStateChanged also fires on background token refreshes and
      // multi-tab sync, not just real sign-ins — re-fetching the profile
      // (and re-showing the full-page spinner) every time made the app
      // feel randomly slow. Only refetch for an actual new sign-in.
      if (loadedUidRef.current === firebaseUser.uid) {
        setProfileReady(true)
        return
      }
      loadedUidRef.current = firebaseUser.uid
      setProfileReady(false)

      const ref = doc(db, 'users', firebaseUser.uid)
      const snap = await getDoc(ref)
      if (snap.exists()) {
        setProfile(snap.data())
      } else {
        const claimed = await claimPendingProfile(firebaseUser)
        const newProfile = {
          displayName: firebaseUser.displayName,
          email:       firebaseUser.email,
          team:        claimed?.team || null,
          role:        'user',
          ...(claimed?.excelName ? { excelName: claimed.excelName } : {}),
          createdAt:   serverTimestamp(),
        }
        await setDoc(ref, newProfile)
        setProfile(newProfile)
      }
      setProfileReady(true)
    })
  }, [])

  async function signInWithMicrosoft() {
    await signInWithPopup(auth, microsoftProvider)
  }

  async function signOutUser() {
    await signOut(auth)
  }

  async function refreshProfile() {
    const uid = auth.currentUser?.uid
    if (!uid) return
    const snap = await getDoc(doc(db, 'users', uid))
    if (snap.exists()) setProfile(snap.data())
  }

  function patchProfile(updates) {
    setProfile(prev => (prev ? { ...prev, ...updates } : prev))
  }

  return (
    <AuthContext.Provider value={{
      user, profile, profileReady,
      signInWithMicrosoft, signOutUser, refreshProfile, patchProfile,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
