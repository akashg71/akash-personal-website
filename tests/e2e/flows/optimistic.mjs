// Optimistic writes: with GitHub slowed down the change shows before the write
// lands, and a failed write is rolled back with the error shown.
import assert from 'node:assert/strict'
import { api, click, fake, flow, waitFor } from '../harness.mjs'

const TODO = `# Todo

## This week

- [ ] Write the e2e harness

## Inbox

- [ ] Sort the photos
`
const seed = { 'todo.md': TODO }
const slowPut = (extra = {}) => fake.fault({ method: 'PUT', path: 'todo.md', delayMs: 1500, ...extra })

const box = title => `input[type=checkbox][aria-label="${title}"]`
const text = label => `::-p-xpath(//span[@role="button"][normalize-space()="${label}"])`
const pendingItem = label => `::-p-xpath(//li[@data-pending][normalize-space()="${label}"])`
const addItem = '::-p-xpath(//button[normalize-space()="+ add item"])' // the first: This week
const newItem = 'input[placeholder="New item"]'
const inputValue = (page, selector) => page.$eval(selector, el => el.value)
const top = (page, selector) => page.$eval(selector, el => Math.round(el.getBoundingClientRect().top))

/** Start `action`, returning the API answer promise and a flag for whether it has arrived. */
function inFlight(page, route, action) {
  const state = { answered: false }
  state.response = api(page, route, action).finally(() => (state.answered = true))
  return state
}

flow('an added item shows before GitHub answers, then becomes a real item', { seed }, async page => {
  await click(page, addItem)
  await slowPut()
  await page.type(newItem, 'Book the dentist')
  const write = inFlight(page, 'add', () => page.keyboard.press('Enter'))
  await waitFor(page, pendingItem('Book the dentist'))
  await waitFor(page, '[data-progress]')
  assert.equal(write.answered, false)
  assert.equal(await fake.read('todo.md'), TODO) // not written yet
  assert.equal(await inputValue(page, newItem), '') // free for the next item
  const before = [await top(page, 'li[data-pending]'), await top(page, newItem)]

  assert.equal((await write.response).status, 200)
  await waitFor(page, box('Book the dentist'))
  await page.waitForSelector('[data-pending]', { hidden: true })
  await page.waitForSelector('[data-progress]', { hidden: true })
  // The real item lands exactly where the placeholder was: no layout shift.
  assert.deepEqual([await top(page, `li:has(${box('Book the dentist')})`), await top(page, newItem)], before)
  assert.equal(await fake.read('todo.md'), TODO.replace('harness\n', 'harness\n- [ ] Book the dentist\n'))
})

flow('quick adds land in order and leave no placeholders behind', { seed }, async page => {
  await click(page, addItem)
  await fake.fault({ method: 'PUT', path: 'todo.md', delayMs: 400, times: 3 })
  for (const item of ['One', 'Two', 'Three']) {
    await page.type(newItem, item)
    await page.keyboard.press('Enter')
  }
  await page.waitForFunction(() => document.querySelectorAll('li[data-pending]').length === 3)
  await waitFor(page, box('Three'))
  await page.waitForSelector('[data-pending]', { hidden: true })
  await page.waitForSelector('[data-progress]', { hidden: true })
  const items = await page.$$eval('li input[type=checkbox][aria-label]', els => els.map(el => el.ariaLabel))
  assert.deepEqual(items, ['Write the e2e harness', 'One', 'Two', 'Three', 'Sort the photos'])
  assert.equal(await fake.read('todo.md'), TODO.replace('harness\n', 'harness\n- [ ] One\n- [ ] Two\n- [ ] Three\n'))
})

flow('a failed add rolls back and gives the text back', { seed, allow: [[502, '/api/notes/add']] }, async page => {
  await click(page, addItem)
  await slowPut({ delayMs: 800, status: 500 })
  await page.type(newItem, 'Book the dentist')
  const write = inFlight(page, 'add', () => page.keyboard.press('Enter'))
  await waitFor(page, pendingItem('Book the dentist'))
  assert.equal((await write.response).status, 502)
  await page.waitForSelector('[data-pending]', { hidden: true })
  await waitFor(page, '[role=alert]::-p-text(Save failed)')
  assert.equal(await inputValue(page, newItem), 'Book the dentist')
  assert.equal(await fake.read('todo.md'), TODO)
})

flow('a rename and a new section show before GitHub answers', { seed }, async page => {
  await click(page, text('Write the e2e harness'))
  await page.locator('li input:not([type])').fill('Write more e2e flows')
  await slowPut()
  let write = inFlight(page, 'rename', () => page.keyboard.press('Enter'))
  await waitFor(page, text('Write more e2e flows'))
  assert.equal(write.answered, false)
  assert.equal(await page.$eval('li input[type=checkbox]', el => el.disabled), true) // held until it lands
  assert.equal((await write.response).status, 200)
  await waitFor(page, box('Write more e2e flows'))

  await click(page, '::-p-xpath(//button[normalize-space()="+ new section"])')
  await page.type('input[placeholder^="Section name"]', 'Someday')
  await slowPut()
  write = inFlight(page, 'section', () => page.keyboard.press('Enter'))
  await waitFor(page, 'div[data-pending] h3::-p-text(Someday)')
  assert.equal(write.answered, false)
  // Drawn where the server inserts it: just before Inbox.
  const nextHeading = await page.$eval('div[data-pending]', el => el.nextElementSibling?.textContent)
  assert.match(nextHeading, /^Inbox/)
  const inbox = 'h3:has(button[aria-label="Delete section Inbox"])'
  const inboxTop = await top(page, inbox)
  assert.equal((await write.response).status, 200)
  await waitFor(page, text('Someday'))
  await page.waitForSelector('[data-pending]', { hidden: true })
  assert.equal(await top(page, inbox), inboxTop) // nothing below it moved
  assert.equal(
    await fake.read('todo.md'),
    TODO.replace('Write the e2e harness', 'Write more e2e flows').replace('## Inbox\n', '## Someday\n\n## Inbox\n'),
  )
})

flow('a failed rename brings the old wording back', { seed, allow: [[502, '/api/notes/rename']] }, async page => {
  await click(page, text('Write the e2e harness'))
  await page.locator('li input:not([type])').fill('Write more e2e flows')
  await slowPut({ delayMs: 800, status: 500 })
  const write = inFlight(page, 'rename', () => page.keyboard.press('Enter'))
  await waitFor(page, text('Write more e2e flows'))
  assert.equal((await write.response).status, 502)
  await waitFor(page, '[role=alert]::-p-text(Save failed)')
  assert.equal(await inputValue(page, 'li input:not([type])'), 'Write more e2e flows') // kept to retry
  await page.keyboard.press('Escape')
  await waitFor(page, text('Write the e2e harness'))
  assert.equal(await fake.read('todo.md'), TODO)
})
