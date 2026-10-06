/* SimproSync entry point - admin-only gate in front of the sync tool.
   Uses the CMCHS Staff Schedule Firebase project (same Microsoft sign-in,
   same users/{uid}.role). Simpro calls go through chs-equipment's existing
   Apps Script proxy, authenticated with this user's Firebase ID token - the
   Simpro key itself never reaches the browser. */
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db, microsoftProvider } from '../src/firebase.js'
import { startApp } from './app.js'

// Same Apps Script web app the equipment tracker uses (chs-equipment/index.html, SIMPRO_PROXY_URL).
const SIMPRO_PROXY_URL = 'https://script.google.com/macros/s/AKfycbzKLt_IP3GPRiNQkYkCep-_Yee06rDwc3uJGnQQuzjVuCSJOImJnaqDgU-3W3q9Y4OHUw/exec'

const $ = id => document.getElementById(id)
let started = false

// SimproSync is a separate entry point from the React app, so it never runs
// vite-plugin-pwa's registerSW - which means nothing on this page ever asked
// the browser to check for a newer service worker. The old one just kept
// serving its precached copy of this page forever, so fixes that were long
// since live on the server never actually reached anyone's browser (closing
// and reopening doesn't help - the stale worker is simply reused). The worker
// itself already does skipWaiting + clients.claim, so it only needed asking.
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller
  navigator.serviceWorker.getRegistration().then(r => r && r.update()).catch(() => {})
  let reloaded = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Only when replacing an existing worker - on a first-ever visit the
    // initial claim would otherwise cause one pointless reload.
    if (!hadController || reloaded) return
    reloaded = true
    location.reload()
  })
}

function gate(state, msg) {
  $('gate').hidden = state === 'ready'
  $('app').hidden = state !== 'ready'
  $('gateMsg').textContent = msg || ''
  $('signIn').hidden = state !== 'signin'
  $('gateSignOut').hidden = !['denied', 'error'].includes(state)
  $('whoBar').hidden = state !== 'ready'
}

const doSignOut = () => signOut(auth).then(() => location.reload())
$('signIn').onclick = async () => {
  try { await signInWithPopup(auth, microsoftProvider) }
  catch (e) { gate('signin', 'Sign-in did not complete: ' + (e.message || e)) }
}
$('gateSignOut').onclick = doSignOut
$('signOut').onclick = doSignOut

// Batches concurrent call(method, path, body) requests made in the same tick
// (e.g. pool()'s Promise.all workers) into one POST to the proxy, each
// carrying up to 25 { method, path, body } entries plus one ID token - far
// fewer Apps Script round trips than one request per call.
function makeTransport() {
  let queue = []
  let flushScheduled = false

  function scheduleFlush() {
    if (flushScheduled) return
    flushScheduled = true
    setTimeout(flush, 0)
  }

  async function flush() {
    flushScheduled = false
    const batch = queue.splice(0, 25)
    if (!batch.length) return
    if (queue.length) scheduleFlush()

    // Logged permanently, not just for this one investigation - batch size
    // and round-trip time per proxy call is exactly what a future slowdown
    // report needs first (it's what found the last one: requests weren't
    // batching because nothing called this concurrently - see app.js).
    const t0 = performance.now()
    const tag = '[simproSync] batch of ' + batch.length

    let idToken
    try {
      idToken = await auth.currentUser.getIdToken()
    } catch (e) {
      console.warn(tag, '- could not get ID token', e)
      batch.forEach(b => b.reject(new Error('Could not get a sign-in token: ' + (e.message || e))))
      return
    }

    let res
    try {
      res = await fetch(SIMPRO_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'simproSync',
          idToken,
          requests: batch.map(b => ({ method: b.method, path: b.path, body: b.body }))
        })
      })
    } catch (e) {
      console.warn(tag, '- network error after', Math.round(performance.now() - t0), 'ms', e)
      batch.forEach(b => b.reject(new Error('Network error reaching the proxy: ' + (e.message || e))))
      return
    }

    let json
    try { json = await res.json() }
    catch (e) {
      console.warn(tag, '- bad response (status ' + res.status + ') after', Math.round(performance.now() - t0), 'ms')
      batch.forEach(b => b.reject(new Error('Bad response from the proxy (' + res.status + ')')))
      return
    }

    if (!json.success) {
      console.warn(tag, '- proxy rejected after', Math.round(performance.now() - t0), 'ms:', json.error)
      const err = new Error(json.error || 'The proxy rejected the request')
      batch.forEach(b => b.reject(err))
      return
    }

    console.log(tag, '- ok in', Math.round(performance.now() - t0), 'ms')
    batch.forEach((b, i) => {
      const r = json.results[i]
      b.resolve(r ? { status: r.status, data: r.data } : { status: 0, data: 'No result from the proxy' })
    })
  }

  return (method, path, body) => new Promise((resolve, reject) => {
    queue.push({ method, path, body, resolve, reject })
    scheduleFlush()
  })
}

gate('loading', 'Checking sign-in…')

onAuthStateChanged(auth, async user => {
  if (started) { if (!user) location.reload(); return }
  if (!user) return gate('signin', 'Sign in with your Cass / CHS Microsoft account. SimproSync is for CMCHS Staff Schedule admins only.')
  try {
    gate('loading', 'Checking access…')
    const prof = await getDoc(doc(db, 'users', user.uid))
    const p = prof.exists() ? prof.data() : null
    if (!p || p.role !== 'admin')
      return gate('denied', `${user.email} is not an admin in the CMCHS Staff Schedule, so SimproSync is not available. An existing admin can give you the admin role.`)
    const name = p.displayName || user.displayName || user.email
    $('whoName').textContent = `${name} (${user.email})`
    started = true
    gate('ready')
    startApp({ transport: makeTransport(), who: `${name} <${user.email}>` })
  } catch (e) {
    gate('error', 'Something went wrong: ' + (e.message || e))
  }
})
