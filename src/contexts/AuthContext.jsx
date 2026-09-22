import { createContext, useContext, useEffect, useState } from 'react'
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db, microsoftProvider } from '../firebase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user,         setUser]         = useState(undefined) // undefined = loading auth
  const [profile,      setProfile]      = useState(null)
  const [profileReady, setProfileReady] = useState(false)   // false until Firestore profile loaded

  useEffect(() => {
    return onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null)
        setProfile(null)
        setProfileReady(true)
        return
      }

      setUser(firebaseUser)
      setProfileReady(false)

      const ref = doc(db, 'users', firebaseUser.uid)
      const snap = await getDoc(ref)
      if (snap.exists()) {
        setProfile(snap.data())
      } else {
        const newProfile = {
          displayName: firebaseUser.displayName,
          email:       firebaseUser.email,
          team:        null,
          role:        'user',
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
