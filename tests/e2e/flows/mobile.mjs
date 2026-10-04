// Phone layout (invariant 6): the files drawer, tapping a task, 44px tap
// targets on task controls, and 16px+ inputs so iOS doesn't zoom on focus.
import assert from 'node:assert/strict'
import { api, fake, flow, waitFor, waitForNote } from '../harness.mjs'

const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }
const MECHANICS = '# Mechanics\n\n## Problems\n\n- [ ] Pendulum period\n- [ ] Rolling ball\n'
const seed = { 'todo.md': '# Todo\n\n## Inbox\n', 'Physics/Mechanics.md': MECHANICS }

const tap = async (page, selector) => (await waitFor(page, selector)).tap()
/** Visible matches, as "name: W×H", and which of them are under 44px either way. */
const targets = (page, selector) => page.$$eval(selector, els => {
  const sized = els.filter(el => el.checkVisibility()).map(el => {
    const r = el.getBoundingClientRect()
    return { label: `${el.getAttribute('aria-label') ?? el.textContent.trim()}: ${Math.round(r.width)}×${Math.round(r.height)}`, small: r.width < 44 || r.height < 44 }
  })
  return { count: sized.length, small: sized.filter(t => t.small).map(t => t.label) }
})

flow('phone: open a note from the drawer and tick a task by tapping', { seed, viewport: PHONE }, async page => {
  await tap(page, '::-p-xpath(//summary[contains(., "files")])')
  await tap(page, '::-p-xpath(//main/section//details//summary[contains(., "Physics")])')
  await tap(page, '::-p-xpath(//main/section//a[normalize-space()="Mechanics"])')
  await waitForNote(page, 'Physics/Mechanics.md')

  const box = 'input[type=checkbox][aria-label="Pendulum period"]'
  assert.equal((await api(page, 'toggle', () => tap(page, box))).status, 200)
  assert.equal(await fake.read('Physics/Mechanics.md'), MECHANICS.replace('- [ ] Pendulum', '- [x] Pendulum'))

  // Two tasks (tick box + ×) and the section's ×.
  const { count, small } = await targets(page, 'main label:has(> input[type=checkbox]), main button[aria-label^="Delete"]')
  assert.equal(count, 5)
  assert.deepEqual(small, [])
  await tap(page, '::-p-xpath(//button[normalize-space()="+ add item"])')
  const fonts = await page.$$eval('input:not([type=checkbox]), textarea', els => els
    .filter(el => el.checkVisibility())
    .map(el => parseFloat(getComputedStyle(el).fontSize)))
  assert.ok(fonts.length && fonts.every(px => px >= 16), `input font sizes: ${fonts}`)
})
