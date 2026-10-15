// Firestore rules tests for Asks (internal.chsnz.co.nz/asks/) — runs the REAL
// rules engine (the emulator), not a mock. Needs Java. From an empty folder:
//   npm i firebase-tools@13 @firebase/rules-unit-testing@3 firebase@10
//   copy firestore.rules + this file in, then:
//   npx firebase emulators:exec --only firestore --project rules-test "node asks-rules.test.mjs"
// (firebase.json: {"emulators":{"firestore":{"host":"127.0.0.1","port":8085}}})
//
// Every write the Asks app makes (cmchs-internal-hub apps/asks/src/store.jsx),
// and the ways someone might try to see or take what isn't theirs.
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import { collection, doc, getDoc, getDocs, query, where, setDoc, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore'

const env = await initializeTestEnvironment({
  projectId: 'rules-test',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8085 },
})

const NOW = 1790000000000
function ask(o) {
  return {
    title: 'Something', details: '', createdBy: 'lee', createdByName: 'Lee', createdAtMs: NOW, updatedAtMs: NOW,
    assignees: [], teams: [], people: ['lee'], owner: '', ownerName: '', status: 'open', waitingOn: '', urgent: false, due: '',
    doneAtMs: 0, doneBy: '', photoCount: 0, commentCount: 0, lastCommentAtMs: 0, lastCommentBy: '',
    event: { id: 'e1', type: 'created', by: o.createdBy || 'lee', atMs: NOW, to: [], teams: [], ref: '' },
    ...o,
  }
}
const statsOf = (a) => ({
  status: a.status, owner: a.owner, assignees: a.assignees, teams: a.teams, due: a.due,
  urgent: a.urgent, createdBy: a.createdBy, createdAtMs: a.createdAtMs, doneAtMs: a.doneAtMs,
})
const A1 = ask({ title: 'Test the new mode on the A7', teams: ['Engineers'] })                    // Lee -> Engineers team
const A2 = ask({ createdBy: 'jess', createdByName: 'Jess', assignees: ['mike', 'sam'], people: ['jess', 'mike', 'sam'],
  owner: 'mike', ownerName: 'Mike', status: 'picked' })                                            // Jess -> Mike and Sam; Mike has it
const A3 = ask({ createdBy: 'mike', createdByName: 'Mike', assignees: ['jess'], people: ['mike', 'jess'] }) // Mike -> Jess

await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  await setDoc(doc(db, 'users/admin1'), { displayName: 'Ann Admin', role: 'admin', team: 'Management' })
  await setDoc(doc(db, 'users/mike'), { displayName: 'Mike', role: 'user', team: 'Engineers' })
  await setDoc(doc(db, 'users/sam'), { displayName: 'Sam', role: 'user', team: 'Engineers' })
  await setDoc(doc(db, 'users/jess'), { displayName: 'Jess', role: 'user', team: 'Sales' })
  await setDoc(doc(db, 'users/lee'), { displayName: 'Lee', role: 'user', team: 'Application' })
  await setDoc(doc(db, 'users/noteam'), { displayName: 'New', role: 'user', team: null })
  for (const [id, a] of [['a1', A1], ['a2', A2], ['a3', A3]]) {
    await setDoc(doc(db, 'asks', id), a)
    await setDoc(doc(db, 'askStats', id), statsOf(a))
  }
  await setDoc(doc(db, 'asks/a2/comments/c1'), { uid: 'mike', name: 'Mike', text: 'Logged it', atMs: NOW, mentions: [], photoIds: [] })
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
/** An update the way store.jsx makes it: the ask and its stats together. */
function change(db, id, before, patch, extra = (b) => b) {
  const after = { ...before, ...patch }
  const b = writeBatch(db)
  b.update(doc(db, 'asks', id), patch)
  b.set(doc(db, 'askStats', id), statsOf(after))
  extra(b, db)
  return b.commit()
}
const JPEG = 'data:image/jpeg;base64,' + 'A'.repeat(2000)

console.log('\nWhat the app does — must work')
await check('Lee raises an ask to the Engineers team, with its stats and a photo', true, () => {
  const db = as('lee')
  const a = ask({ title: 'New one', teams: ['Engineers'] })
  const b = writeBatch(db)
  b.set(doc(db, 'asks/n1'), a)
  b.set(doc(db, 'askStats/n1'), statsOf(a))
  b.set(doc(db, 'asks/n1/photos/p1'), { uid: 'lee', data: JPEG, w: 10, h: 10, atMs: NOW, commentId: '' })
  return b.commit()
})
await check('Mike reads an ask sent to his team', true, () => getDoc(doc(as('mike'), 'asks/a1')))
await check('Mike lists his team\'s asks (teams array-contains)', true, () => getDocs(query(collection(as('mike'), 'asks'), where('teams', 'array-contains', 'Engineers'))))
await check('Jess lists asks naming her (people array-contains)', true, () => getDocs(query(collection(as('jess'), 'asks'), where('people', 'array-contains', 'jess'))))
await check('an admin lists every ask', true, () => getDocs(collection(as('admin1'), 'asks')))
await check('anyone signed in reads the company counts', true, () => getDocs(query(collection(as('jess'), 'askStats'), where('status', 'in', ['open', 'picked', 'waiting']))))
await check('Mike picks up the team ask', true, () => change(as('mike'), 'a1', A1, { owner: 'mike', ownerName: 'Mike', status: 'picked', people: ['lee', 'mike'] }))
const A1m = { ...A1, owner: 'mike', ownerName: 'Mike', status: 'picked', people: ['lee', 'mike'] }
await check('Sam comments on A2, @mentioning Lee, who joins its people', true, () => change(as('sam'), 'a2', A2,
  { commentCount: 1, people: ['jess', 'mike', 'sam', 'lee'] },
  (b, db) => b.set(doc(db, 'asks/a2/comments/c2'), { uid: 'sam', name: 'Sam', text: '@Lee can you look?', atMs: NOW, mentions: ['lee'], photoIds: [] })))
const A2c = { ...A2, commentCount: 1, people: ['jess', 'mike', 'sam', 'lee'] }
await check('Lee, now mentioned, can read A2 and its comments', true, () => getDocs(collection(as('lee'), 'asks/a2/comments')))
await check('Mike marks A1 waiting on Mindray', true, () => change(as('mike'), 'a1', A1m, { status: 'waiting', waitingOn: 'Mindray' }))
await check('Mike hands A1 back', true, () => change(as('mike'), 'a1', A1m, { owner: '', ownerName: '', status: 'open', waitingOn: '' }))
await check('Jess (the asker) gives A2 to Sam', true, () => change(as('jess'), 'a2', A2c, { owner: 'sam', ownerName: 'Sam' }))
const A2s = { ...A2c, owner: 'sam', ownerName: 'Sam' }
await check('Sam marks A2 done', true, () => change(as('sam'), 'a2', A2s, { status: 'done', doneAtMs: NOW + 1, doneBy: 'Sam' }))
await check('Mike deletes his own comment', true, () => deleteDoc(doc(as('mike'), 'asks/a2/comments/c1')))
await check('Mike (the asker) deletes A3 with its stats', true, () => {
  const db = as('mike'); const b = writeBatch(db)
  b.delete(doc(db, 'askStats/a3')); b.delete(doc(db, 'asks/a3'))
  return b.commit()
})

console.log('\nWhat must be refused')
await check('Jess (Sales) reads an ask sent to Engineers', false, () => getDoc(doc(as('jess'), 'asks/a1')))
await check('Jess lists every ask', false, () => getDocs(collection(as('jess'), 'asks')))
await check('Jess lists the Engineers team\'s asks', false, () => getDocs(query(collection(as('jess'), 'asks'), where('teams', 'array-contains', 'Engineers'))))
await check('someone with no team lists asks by an empty team', false, () => getDocs(query(collection(as('noteam'), 'asks'), where('teams', 'array-contains', ''))))
await check('Jess adds herself to an ask she can\'t see', false, () => change(as('jess'), 'a1', A1, { people: ['lee', 'jess'] }))
await check('Jess comments on an ask she can\'t see', false, () => setDoc(doc(as('jess'), 'asks/a1/comments/x'), { uid: 'jess', name: 'Jess', text: 'hi', atMs: NOW, mentions: [], photoIds: [] }))
await check('Jess reads the comments of an ask she can\'t see', false, () => getDocs(collection(as('jess'), 'asks/a1/comments')))
await check('a comment signed as someone else', false, () => setDoc(doc(as('sam'), 'asks/a2/comments/y'), { uid: 'mike', name: 'Mike', text: 'not me', atMs: NOW, mentions: [], photoIds: [] }))
await check('Mike takes A2 from Sam', false, () => change(as('mike'), 'a2', { ...A2s, status: 'done', doneAtMs: NOW + 1, doneBy: 'Sam' }, { owner: 'mike', ownerName: 'Mike' }))
await check('raising an ask as someone else', false, () => setDoc(doc(as('jess'), 'asks/n2'), ask({ createdBy: 'lee', people: ['lee', 'jess'], assignees: ['jess'] })))
await check('raising an ask already picked up', false, () => setDoc(doc(as('lee'), 'asks/n3'), ask({ teams: ['Sales'], owner: 'lee', status: 'picked' })))
await check('raising an ask sent to nobody', false, () => setDoc(doc(as('lee'), 'asks/n4'), ask({})))
await check('an ask with an unknown team', false, () => setDoc(doc(as('lee'), 'asks/n5'), ask({ teams: ['Pirates'] })))
await check('an ask with extra fields', false, () => setDoc(doc(as('lee'), 'asks/n6'), ask({ teams: ['Sales'], role: 'admin' })))
await check('stats that don\'t match the ask', false, () => setDoc(doc(as('lee'), 'askStats/a1'), { ...statsOf(A1), owner: 'lee' }))
await check('stats carrying text', false, () => setDoc(doc(as('lee'), 'askStats/a1'), { ...statsOf(A1), title: 'leak' }))
await check('stats for an ask that doesn\'t exist', false, () => setDoc(doc(as('lee'), 'askStats/ghost'), statsOf(A1)))
await check('deleting the stats of an ask that still exists', false, () => deleteDoc(doc(as('lee'), 'askStats/a1')))
await check('Mike (involved, not the asker) deletes A1', false, () => deleteDoc(doc(as('mike'), 'asks/a1')))
await check('a photo that isn\'t a JPEG data URL', false, () => setDoc(doc(as('lee'), 'asks/a1/photos/p2'), { uid: 'lee', data: 'https://example.com/x.png', w: 1, h: 1, atMs: NOW, commentId: '' }))
await check('a photo over the size limit', false, () => setDoc(doc(as('lee'), 'asks/a1/photos/p3'), { uid: 'lee', data: 'data:image/jpeg;base64,' + 'A'.repeat(500000), w: 1, h: 1, atMs: NOW, commentId: '' }))
await check('signed out: the company counts', false, () => getDocs(collection(anon, 'askStats')))
await check('signed out: an ask', false, () => getDoc(doc(anon, 'asks/a1')))

console.log(`\n${pass} passed, ${fail} failed`)
await env.cleanup()
process.exit(fail ? 1 : 0)
