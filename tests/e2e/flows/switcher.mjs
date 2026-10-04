// ⌘K quick switcher: ranked search, keyboard navigation, create from it.
import assert from 'node:assert/strict'
import { api, fake, flow, waitFor, waitForNote } from '../harness.mjs'

const seed = {
  'todo.md': '# Todo\n\n## Inbox\n',
  'Physics/Mechanics.md': '# Mechanics\n',
  'Physics/Quantum Mechanics.md': '# Quantum Mechanics\n',
  'Physics/Optics.md': '# Optics\n',
  'Projects/Website.md': '# Website\n',
}
const dialog = '[role=dialog][aria-label="Open note"]'

async function openSwitcher(page) {
  await page.keyboard.down('Meta')
  await page.keyboard.press('k')
  await page.keyboard.up('Meta')
  await waitFor(page, `${dialog} input`)
}

const rows = page => page.$$eval(`${dialog} li button`, els => els.map(el => el.textContent))

flow('⌘K ranks matches; arrows and Enter open one; Escape closes', { seed }, async page => {
  await openSwitcher(page)
  await page.keyboard.press('Escape')
  await page.waitForSelector(dialog, { hidden: true })

  await openSwitcher(page)
  await page.keyboard.type('mech')
  // Each row is name + folder; "Mechanics" is a prefix match so it ranks first.
  await page.waitForFunction(d => document.querySelectorAll(`${d} li button`).length === 3, {}, dialog)
  assert.deepEqual(await rows(page), ['MechanicsPhysics', 'Quantum MechanicsPhysics', '+ Create “mech”'])
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await waitForNote(page, 'Physics/Quantum Mechanics.md')
  await page.waitForSelector(dialog, { hidden: true })
  await waitFor(page, 'h1 ::-p-text(Quantum Mechanics)')
})

flow('⌘K creates a note, in a new folder, when nothing matches', { seed }, async page => {
  await openSwitcher(page)
  await page.keyboard.type('Ideas/Fresh idea')
  await page.waitForFunction(d => document.querySelector(`${d} li button`)?.textContent.startsWith('+ Create'), {}, dialog)
  assert.deepEqual(await rows(page), ['+ Create “Ideas/Fresh idea”'])
  assert.equal((await api(page, 'create', () => page.keyboard.press('Enter'))).status, 200)
  await waitForNote(page, 'Ideas/Fresh idea.md')
  assert.equal(await fake.read('Ideas/Fresh idea.md'), '# Fresh idea\n\n')
})
