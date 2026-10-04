// Checklist writes: tick, rename, add, delete, review stamp. Each asserts the
// exact bytes the fake repo holds afterwards — only the intended line changes.
import assert from 'node:assert/strict'
import { alertText, api, click, fake, flow, lastCommit, open, waitFor } from '../harness.mjs'

const TODO = `# Todo

## This week

- [ ] Write the e2e harness
- [x] Ship the vault
- [ ] Pay the £2,400 invoice

## Reading list

- [ ] The Art of Doing Science

## Inbox

- [ ] Sort the photos
`
const seed = { 'todo.md': TODO }

const box = title => `input[type=checkbox][aria-label="${title}"]`
const text = label => `::-p-xpath(//span[@role="button"][normalize-space()="${label}"])`
const isChecked = (page, title) => page.$eval(box(title), el => el.checked)

flow('tick and untick change exactly that line', { seed }, async page => {
  await waitFor(page, box('Write the e2e harness'))
  assert.equal((await api(page, 'toggle', () => click(page, box('Write the e2e harness')))).status, 200)
  assert.equal(await fake.read('todo.md'), TODO.replace('- [ ] Write the e2e harness', '- [x] Write the e2e harness'))
  assert.equal(await lastCommit(), 'tick: Write the e2e harness')
  assert.equal(await isChecked(page, 'Write the e2e harness'), true)

  assert.equal((await api(page, 'toggle', () => click(page, box('Write the e2e harness')))).status, 200)
  assert.equal(await fake.read('todo.md'), TODO)
  assert.equal(await lastCommit(), 'untick: Write the e2e harness')
})

flow('tick in a CRLF file keeps its line endings', {
  seed: { ...seed, 'crlf.md': '# CRLF\r\n\r\n## Tasks\r\n\r\n- [ ] Windows task\r\n- [ ] Other\r\n' },
}, async page => {
  await open(page, 'crlf.md')
  assert.equal((await api(page, 'toggle', () => click(page, box('Windows task')))).status, 200)
  assert.equal(await fake.read('crlf.md'), '# CRLF\r\n\r\n## Tasks\r\n\r\n- [x] Windows task\r\n- [ ] Other\r\n')
})

flow('a tick lands after one conflicting commit (the single retry)', { seed }, async page => {
  // Another device adds a line above the task between our GET and PUT: the PUT
  // gets a 409, the retry re-reads, finds the moved line by its text, and lands.
  const phone = TODO.replace('- [ ] Write the e2e harness', '- [ ] Added on the phone\n- [ ] Write the e2e harness')
  await waitFor(page, box('Write the e2e harness'))
  await fake.fault({ method: 'PUT', path: 'todo.md', write: phone })
  assert.equal((await api(page, 'toggle', () => click(page, box('Write the e2e harness')))).status, 200)
  assert.equal(await fake.read('todo.md'), phone.replace('- [ ] Write the e2e harness', '- [x] Write the e2e harness'))
  const puts = (await fake.requests()).requests.filter(r => r.route === 'contents.put')
  assert.deepEqual(puts.map(r => r.status), [409, 200])
  assert.equal(await alertText(page), null)
})

flow('a tick that keeps conflicting is reported and rolled back', {
  seed,
  allow: [[409, '/api/notes/toggle']],
}, async page => {
  await waitFor(page, box('Write the e2e harness'))
  await fake.fault({ method: 'PUT', path: 'todo.md', status: 409, times: 2 })
  assert.equal((await api(page, 'toggle', () => click(page, box('Write the e2e harness')))).status, 409)
  await waitFor(page, '[role=alert]::-p-text(kept changing)')
  assert.equal(await isChecked(page, 'Write the e2e harness'), false)
  assert.equal(await fake.read('todo.md'), TODO)
})

flow('inline rename of a task keeps its checkbox and bullet', { seed }, async page => {
  await click(page, text('Ship the vault'))
  await page.locator('li input:not([type])').fill('Ship the vault v2')
  assert.equal((await api(page, 'rename', () => page.keyboard.press('Enter'))).status, 200)
  await waitFor(page, box('Ship the vault v2'))
  assert.equal(await isChecked(page, 'Ship the vault v2'), true)
  assert.equal(await fake.read('todo.md'), TODO.replace('- [x] Ship the vault', '- [x] Ship the vault v2'))
  assert.equal(await lastCommit(), 'edit: Ship the vault v2')
})

flow('inline rename of a section heading', { seed }, async page => {
  await click(page, text('Reading list'))
  await page.locator('h3 input').fill('Books')
  assert.equal((await api(page, 'rename', () => page.keyboard.press('Enter'))).status, 200)
  await waitFor(page, text('Books'))
  assert.equal(await fake.read('todo.md'), TODO.replace('## Reading list', '## Books'))
})

flow('add an item to a section', { seed }, async page => {
  const add = '::-p-xpath(//h3[.//span[@role="button"][normalize-space()="Reading list"]]/following::button[normalize-space()="+ add item"][1])'
  await click(page, add)
  await page.type('input[placeholder="New item"]', 'Gödel, Escher, Bach')
  assert.equal((await api(page, 'add', () => page.keyboard.press('Enter'))).status, 200)
  await waitFor(page, box('Gödel, Escher, Bach'))
  assert.equal(await fake.read('todo.md'), TODO.replace('Doing Science\n', 'Doing Science\n- [ ] Gödel, Escher, Bach\n'))
  assert.equal(await lastCommit(), 'add: Gödel, Escher, Bach')
})

flow('delete an item after confirming', { seed }, async (page, { dialogs }) => {
  assert.equal((await api(page, 'delete', () => click(page, 'button[aria-label="Delete Ship the vault"]'))).status, 200)
  await page.waitForSelector(box('Ship the vault'), { hidden: true })
  assert.deepEqual(dialogs, ['Delete “Ship the vault”?'])
  assert.equal(await fake.read('todo.md'), TODO.replace('- [x] Ship the vault\n', ''))
  assert.equal(await lastCommit(), 'delete: Ship the vault')
})

flow('mark the weekly review stamps today under the title', { seed }, async page => {
  const today = await page.evaluate(() => new Date().toLocaleDateString('sv')) // YYYY-MM-DD, local
  assert.equal((await api(page, 'review', () => click(page, '::-p-text(mark reviewed)'))).status, 200)
  await waitFor(page, '::-p-text(Reviewed today.)')
  assert.equal(await fake.read('todo.md'), TODO.replace('# Todo\n', `# Todo\n\nLast reviewed: ${today}\n`))
})
