import { getToken, onMessage } from 'firebase/messaging'
import { doc, updateDoc, arrayUnion } from 'firebase/firestore'
import { db, messagingPromise } from '../firebase'

const ENABLED_KEY = 'wtw_push_enabled'

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

/**
 * iOS Safari only allows the notification permission prompt from an
 * installed (Home Screen) PWA, not a regular browser tab — so on iOS this
 * also gates on standalone mode. Android Chrome has no such restriction.
 */
export function canUsePush() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return false
  if (isIOS() && !isStandalone()) return false
  return true
}

export function needsHomeScreenInstall() {
  return isIOS() && !isStandalone()
}

export function pushEnabledOnThisDevice() {
  try {
    return localStorage.getItem(ENABLED_KEY) === '1'
  } catch {
    return false
  }
}

function rememberEnabled() {
  try {
    localStorage.setItem(ENABLED_KEY, '1')
  } catch {
    // localStorage unavailable (private mode etc.) — not fatal, just means
    // the opt-in card may reappear next visit.
  }
}

export async function enablePush(uid) {
  const messaging = await messagingPromise
  if (!messaging) throw new Error('Push notifications are not supported in this browser.')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notification permission was not granted.')

  const registration = await navigator.serviceWorker.ready
  const token = await getToken(messaging, {
    vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY,
    serviceWorkerRegistration: registration,
  })
  if (!token) throw new Error('Could not get a push token for this device.')

  await updateDoc(doc(db, 'users', uid), { fcmTokens: arrayUnion(token) })
  rememberEnabled()
  return token
}

/** Foreground messages don't trigger an OS notification — show a toast instead. */
export async function onForegroundMessage(callback) {
  const messaging = await messagingPromise
  if (!messaging) return () => {}
  return onMessage(messaging, (payload) => callback(payload.notification))
}
