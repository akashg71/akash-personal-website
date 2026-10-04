import assert from 'node:assert/strict'
import { api, click, fake, flow, lastCommit, waitFor } from '../harness.mjs'

const TODO = `# Todo

## This week

- [ ] Write the e2e harness

## Reading list

- [ ] The Art of Doing Science
  - [ ] Chapter 1

## Inbox

- [ ] Sort the photos
`
const seed = { 'todo.md': TODO }
const heading = title => `::-p-xpath(//h3//span[@role="button"][normalize-space()="${title}"])`
const newSection = '::-p-xpath(//button[normalize-space()="+ new section"])'

flow('delete a section and everything under it', { seed }, async (page, { dialogs }) => {
  const res = await api(page, 'delete', () => click(page, 'button[aria-label="Delete section Reading list"]'))
  assert.equal(res.status, 200)
  await page.waitForSelector(heading('Reading list'), { hidden: true })
  assert.deepEqual(dialogs, ['Delete the “Reading list” section and everything under it?'])
  assert.equal(await fake.read('todo.md'), TODO.replace('## Reading list\n\n- [ ] The Art of Doing Science\n  - [ ] Chapter 1\n\n', ''))
  assert.equal(await lastCommit(), 'delete section: Reading list')
})

flow('a new section goes before Inbox', { seed }, async page => {
  await click(page, newSection)
  await page.type('input[placeholder^="Section name"]', 'Someday')
  assert.equal((await api(page, 'section', () => page.keyboard.press('Enter'))).status, 200)
  await waitFor(page, heading('Someday'))
  assert.equal(await fake.read('todo.md'), TODO.replace('## Inbox\n', '## Someday\n\n## Inbox\n'))
  assert.equal(await lastCommit(), 'section: Someday')
})

flow('a duplicate section name is refused', { seed, allow: [[409, '/api/notes/section']] }, async page => {
  await click(page, newSection)
  await page.type('input[placeholder^="Section name"]', 'inbox')
  assert.equal((await api(page, 'section', () => page.keyboard.press('Enter'))).status, 409)
  await waitFor(page, '[role=alert]::-p-text(already exists)')
  assert.equal(await fake.read('todo.md'), TODO)
})
