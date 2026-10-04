// The vault snapshot (lib/notes/snapshot.ts): a warm page load costs one free
// 304, our own writes show on the next load without downloading anything, a
// commit from another device shows on the next load, and pages still work
// when GraphQL fails.
import assert from 'node:assert/strict'
import { api, click, fake, flow, open, waitFor } from '../harness.mjs'

const TODO = '# Todo\n\n## Inbox\n\n- [ ] Buy milk\n'
const seed = { 'todo.md': TODO, 'Ideas.md': '# Ideas\n\nA quiet note.\n' }

/** GitHub calls since the log was last cleared, as "route status", sorted. */
const calls = async () => (await fake.requests()).requests.map(r => `${r.route} ${r.status}`).sort()
const free = list => list.length > 0 && list.every(c => c === 'commits.get 304')

/** Loads `path` until a load is free: a cold server fills the snapshot after it answers. */
async function warm(page, path) {
  for (let i = 0; i < 5; i++) {
    await fake.clearRequests()
    await open(page, path)
    if (free(await calls())) return
    await new Promise(r => setTimeout(r, 200))
  }
  assert.fail(`loads of ${path} never became free: ${(await calls()).join(', ')}`)
}

const box = title => `input[type=checkbox][aria-label="${title}"]`
const paragraph = text => `::-p-xpath(//p[normalize-space()="${text}"])`

flow('a warm load costs only a free 304, for each note once seen', { seed }, async page => {
  await warm(page, 'todo.md')
  await warm(page, 'Ideas.md')
  await fake.clearRequests()
  await open(page, 'todo.md')
  await waitFor(page, box('Buy milk'))
  assert.ok(free(await calls()), (await calls()).join(', '))
})

flow('a tick shows on the next load with no download', { seed }, async page => {
  await warm(page, 'todo.md')
  assert.equal((await api(page, 'toggle', () => click(page, box('Buy milk')))).status, 200)
  assert.equal(await fake.read('todo.md'), TODO.replace('- [ ]', '- [x]'))
  await fake.clearRequests()
  await open(page, 'todo.md')
  assert.equal(await page.$eval(box('Buy milk'), el => el.checked), true)
  assert.ok(free(await calls()), (await calls()).join(', '))
})

flow('a commit from another device shows on the next load', { seed }, async page => {
  await warm(page, 'Ideas.md')
  await fake.write({ 'Ideas.md': '# Ideas\n\nWritten on the phone.\n' })
  await fake.clearRequests()
  await open(page, 'Ideas.md')
  await waitFor(page, paragraph('Written on the phone.'))
  const got = await calls()
  for (const c of ['commits.get 200', 'git.trees.get 200', 'graphql 200']) assert.ok(got.includes(c), got.join(', '))
})

flow('pages still load when GraphQL fails', { seed }, async page => {
  await warm(page, 'Ideas.md')
  // Refused: the changed note comes from the REST blob endpoint instead.
  await fake.fault({ route: 'graphql', status: 403 })
  await fake.write({ 'Ideas.md': '# Ideas\n\nFrom a raw blob.\n' })
  await open(page, 'Ideas.md')
  await waitFor(page, paragraph('From a raw blob.'))
  // GraphQL and the blob endpoint both down: the page reads the file directly.
  await fake.fault({ route: 'graphql', status: 502 })
  await fake.fault({ route: 'git.blobs.get', status: 502 })
  await fake.write({ 'Ideas.md': '# Ideas\n\nFrom the contents API.\n' })
  await fake.clearRequests()
  await open(page, 'Ideas.md')
  await waitFor(page, paragraph('From the contents API.'))
  assert.ok((await calls()).includes('contents.get 200'))
})
