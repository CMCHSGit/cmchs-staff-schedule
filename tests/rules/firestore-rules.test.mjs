// Firestore rules tests — runs the REAL rules engine (the emulator), not a mock.
// Needs Java. From an empty folder:
//   npm i firebase-tools@13 @firebase/rules-unit-testing@3 firebase@10
//   copy firestore.rules + this file in, then:
//   npx firebase emulators:exec --only firestore --project rules-test "node firestore-rules.test.mjs"
// (firebase.json: {"emulators":{"firestore":{"host":"127.0.0.1","port":8085}}})

// Runs the real Firestore rules engine (emulator) against every write the
// apps legitimately make, and every attack the new rules must stop.
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, deleteDoc, arrayUnion, serverTimestamp } from 'firebase/firestore'

const env = await initializeTestEnvironment({
  projectId: 'rules-test',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8085 },
})

// Seed with rules off: an admin, two settled users, and a placeholder.
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  await setDoc(doc(db, 'users/admin1'), { displayName: 'Ann Admin', role: 'admin', team: 'Management' })
  await setDoc(doc(db, 'users/bob'), { displayName: 'Bob Sales', role: 'user', team: 'Sales' })
  await setDoc(doc(db, 'users/zed'), { displayName: 'Zed Target', role: 'user', team: 'Sales' })
  await setDoc(doc(db, 'users/notyet'), { displayName: 'Nat New', role: 'user', team: null })
  await setDoc(doc(db, 'users/pending-carl'), { displayName: 'Carl Pending', role: 'user', team: 'Engineers', pending: true })
  await setDoc(doc(db, 'users/pending-dee'), { displayName: 'Dee Pending', role: 'user', team: 'Sales', pending: true })
})

const as = (uid) => env.authenticatedContext(uid).firestore()
const anon = env.unauthenticatedContext().firestore()
let pass = 0, fail = 0
async function check(label, expectAllowed, fn) {
  try {
    await (expectAllowed ? assertSucceeds(fn()) : assertFails(fn()))
    pass++; console.log(`  ok    ${expectAllowed ? 'allow' : 'deny '}  ${label}`)
  } catch (e) {
    fail++; console.log(`  FAIL  expected ${expectAllowed ? 'allow' : 'deny'}: ${label}\n        ${String(e.message).split('\n')[0]}`)
  }
}

console.log('\nLegitimate writes the apps make — must keep working')
await check('new user creates own profile (AuthContext)', true, () =>
  setDoc(doc(as('newbie'), 'users/newbie'), { displayName: 'New Bee', email: 'n@cass.co.nz', team: null, role: 'user', createdAt: serverTimestamp() }))
await check('new user claims a placeholder (team carried over)', true, () =>
  setDoc(doc(as('carl'), 'users/carl'), { displayName: 'Carl P', email: 'c@cass.co.nz', team: 'Engineers', role: 'user', excelName: 'Carl', createdAt: serverTimestamp() }))
await check('user picks a team while theirs is empty (TeamOnboarding)', true, () =>
  updateDoc(doc(as('notyet'), 'users/notyet'), { team: 'Engineers' }))
await check('user registers a phone for push (push.js)', true, () =>
  updateDoc(doc(as('bob'), 'users/bob'), { fcmTokens: arrayUnion('tok-123') }))
await check('first-time sign-in deletes the placeholder it claims', true, () =>
  deleteDoc(doc(as('brandnew'), 'users/pending-dee')))
await check('admin changes someone\'s role (Admin page)', true, () =>
  updateDoc(doc(as('admin1'), 'users/zed'), { role: 'admin' }))
await check('admin changes someone\'s team', true, () =>
  updateDoc(doc(as('admin1'), 'users/zed'), { team: 'Engineers' }))
await check('admin creates a placeholder', true, () =>
  setDoc(doc(as('admin1'), 'users/pending-eve'), { displayName: 'Eve', team: 'Sales', role: 'user', pending: true, createdAt: serverTimestamp() }))
await check('anyone signed in reads the roster', true, () => getDoc(doc(as('bob'), 'users/admin1')))

console.log('\nThe hole — must now be refused')
await check('user makes themselves admin', false, () =>
  updateDoc(doc(as('bob'), 'users/bob'), { role: 'admin' }))
await check('user grants themselves simproAccess', false, () =>
  updateDoc(doc(as('bob'), 'users/bob'), { simproAccess: true }))
await check('user changes a team already set (Sales -> Engineers)', false, () =>
  updateDoc(doc(as('bob'), 'users/bob'), { team: 'Engineers' }))
await check('new user creates own profile as admin', false, () =>
  setDoc(doc(as('sneak'), 'users/sneak'), { displayName: 'S', role: 'admin', createdAt: serverTimestamp() }))
await check('new user creates own profile with simproAccess', false, () =>
  setDoc(doc(as('sneak2'), 'users/sneak2'), { displayName: 'S', role: 'user', simproAccess: true }))
await check('user overwrites own profile whole (setDoc) to admin', false, () =>
  setDoc(doc(as('bob'), 'users/bob'), { displayName: 'Bob', role: 'admin', team: 'Sales' }))
await check('settled user deletes someone else\'s placeholder', false, () =>
  deleteDoc(doc(as('bob'), 'users/pending-carl')))
await check('user edits someone else\'s record', false, () =>
  updateDoc(doc(as('bob'), 'users/notyet'), { team: 'Sales' }))
await check('signed-out read of the roster', false, () => getDoc(doc(anon, 'users/bob')))

console.log(`\n${pass} passed, ${fail} failed`)
await env.cleanup()
process.exit(fail ? 1 : 0)
