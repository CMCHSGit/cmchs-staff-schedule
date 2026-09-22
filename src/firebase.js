import { initializeApp } from 'firebase/app'
import { getAuth, OAuthProvider } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getMessaging, isSupported } from 'firebase/messaging'

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const db   = getFirestore(app)

// Not every browser supports FCM (e.g. Safari outside a standalone PWA on
// older iOS) — resolves to null there instead of throwing.
export const messagingPromise = isSupported().then(ok => ok ? getMessaging(app) : null)

// Microsoft (Entra ID / Azure AD) OAuth provider
export const microsoftProvider = new OAuthProvider('microsoft.com')
microsoftProvider.setCustomParameters({
  tenant: import.meta.env.VITE_AZURE_TENANT_ID,
  // Forces account picker so people can't get stuck on wrong account
  prompt: 'select_account',
})
