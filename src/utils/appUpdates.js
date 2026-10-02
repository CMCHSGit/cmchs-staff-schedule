import { useEffect, useState } from 'react'

/**
 * Keeps an installed copy of the app on the latest version.
 *
 * The app is saved on each device so it opens instantly and works offline.
 * On its own, a phone only looks for a new version when the app is freshly
 * launched, and shows it one launch later — and an iPhone pauses the app
 * moments after it leaves the screen, which can cut that download short. So
 * a phone could sit on an old version for days. Instead:
 *  - the app asks for a newer version whenever it comes back to the front
 *    (and every hour while it stays open);
 *  - once a newer version has taken over, a page nobody has touched switches
 *    itself over, while one that's been used shows an "Update" banner — a
 *    reload part-way through an edit would lose it;
 *  - "Check for updates" in the account menu does the same on demand, and
 *    can recover when the automatic route is stuck.
 */

const CHECK_EVERY = 60 * 60 * 1000
const MIN_GAP = 30 * 1000

let lastCheck = 0

const getRegistration = () => navigator.serviceWorker.getRegistration().catch(() => undefined)

/** Asks the browser to look for a newer version (a cheap conditional request for sw.js). */
export async function checkInBackground({ force = false } = {}) {
  if (!('serviceWorker' in navigator)) return
  if (!force && Date.now() - lastCheck < MIN_GAP) return
  lastCheck = Date.now()
  try {
    await (await getRegistration())?.update()
  } catch {
    // Offline, or a check is already running — the next one will do.
  }
}

/**
 * Watches for a newer version and hands back { updateReady, applyUpdate }.
 * Mount once, near the top of the app.
 */
export function useAppUpdates() {
  const [updateReady, setUpdateReady] = useState(false)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    let touched = false // has anyone used this page since it loaded?
    let hadController = !!navigator.serviceWorker.controller

    const markTouched = () => { touched = true }
    const onControllerChange = () => {
      // The very first install also "takes over" an uncontrolled page — that's
      // not an update, just the app being saved for the first time.
      if (!hadController) { hadController = true; return }
      if (touched) setUpdateReady(true)
      else window.location.reload()
    }
    const onFront = () => { if (document.visibilityState === 'visible') checkInBackground() }
    const onPageShow = e => { if (e.persisted) onFront() } // restored from the browser's back/forward cache
    const onOnline = () => checkInBackground()

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
    window.addEventListener('pointerdown', markTouched, true)
    window.addEventListener('keydown', markTouched, true)
    document.addEventListener('visibilitychange', onFront)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('online', onOnline)
    const timer = setInterval(() => checkInBackground(), CHECK_EVERY)

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
      window.removeEventListener('pointerdown', markTouched, true)
      window.removeEventListener('keydown', markTouched, true)
      document.removeEventListener('visibilitychange', onFront)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('online', onOnline)
      clearInterval(timer)
    }
  }, [])

  return { updateReady, applyUpdate: () => window.location.reload() }
}

// ── "Check for updates" ───────────────────────────────────────────────────
// Compares the script this page is running with the one the live site hands
// out right now — a check that doesn't depend on the service worker at all.

const SCRIPT = /\/assets\/index-[\w-]+\.js/

function runningScript() {
  const el = [...document.scripts].find(s => SCRIPT.test(s.src))
  return el ? new URL(el.src).pathname : null
}

/** The live site's current script, null if it has none, undefined if it couldn't be reached. */
async function liveScript() {
  try {
    // The query string keeps this out of the service worker's saved copy of the
    // page, and no-store skips the browser's own — so it's the real current file.
    const res = await fetch(`/index.html?check=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return undefined
    return (await res.text()).match(SCRIPT)?.[0] ?? null
  } catch {
    return undefined
  }
}

/** Resolves true if a newer service worker takes over within `ms`. */
function waitForTakeover(registration, ms) {
  return new Promise(resolve => {
    const finish = result => {
      clearTimeout(timer)
      navigator.serviceWorker.removeEventListener('controllerchange', onChange)
      resolve(result)
    }
    const onChange = () => finish(true)
    const timer = setTimeout(() => finish(false), ms)
    navigator.serviceWorker.addEventListener('controllerchange', onChange)
    registration.update().catch(() => {})
  })
}

/**
 * Clears the saved copy of the app so the next load fetches fresh files. The
 * service worker itself is left registered on purpose: removing it would also
 * cancel this device's Thursday reminders.
 */
async function dropSavedCopy() {
  try {
    const names = await caches.keys()
    await Promise.all(names.filter(n => n.includes('precache')).map(n => caches.delete(n)))
  } catch {
    // Nothing saved, or no cache access — the reload still fetches from the network.
  }
}

/**
 * Looks for a newer version now. Resolves to 'latest', 'offline' or
 * 'updating' (a newer version is out, and the page is reloading onto it).
 */
export async function checkForUpdates() {
  const live = await liveScript()
  if (live === undefined) return 'offline'
  const running = runningScript()
  if (!live || !running || live === running) {
    checkInBackground({ force: true }) // same files — still let the service worker look
    return 'latest'
  }
  const registration = 'serviceWorker' in navigator ? await getRegistration() : undefined
  const tookOver = registration ? await waitForTakeover(registration, 10000) : false
  if (!tookOver) await dropSavedCopy() // the automatic route is stuck — force fresh files
  window.location.reload()
  return 'updating'
}
