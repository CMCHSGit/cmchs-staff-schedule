import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc, setDoc, deleteDoc, collection, query, where, getDocs, serverTimestamp } from 'firebase/firestore'
import { auth, db, microsoftProvider } from '../firebase'

/**
 * Admin → Users can bulk-create "pending" placeholder profiles (team,
 * excelName) for staff who haven't signed in yet, keyed by a made-up id
 * rather than their eventual real uid (which doesn't exist until they do).
 * On an actual first sign-in, adopt one of those placeholders by matching
 * first name — but only when exactly one pending record shares it. Two
 * pending people with the same first name (e.g. two "Mark"s) are left
 * alone rather than guessed at; an admin sorts those out by hand, since a
 * wrong auto-merge silently hands someone the wrong team assignment.
 */
async function claimPendingProfile(firebaseUser) {
  const firstName = (firebaseUser.displayName || '').trim().split(/\s+/)[0]?.toLowerCase()
  if (!firstName) return null

  const snap = await getDocs(query(collection(db, 'users'), where('pending', '==', true)))
  const matches = snap.docs.filter(d => {
    const pendingFirst = (d.data().displayName || '').trim().split(/\s+/)[0]?.toLowerCase()
    return pendingFirst === firstName
  })
  if (matches.length !== 1) return null

  const pending = matches[0]
  await deleteDoc(pending.ref)
  return pending.data()
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
