// Files and folders: new note, new folder, note inside a folder, delete note,
// and the "today" journal button.
import assert from 'node:assert/strict'
import { api, click, fake, flow, lastCommit, open, waitFor, waitForNote } from '../harness.mjs'

const seed = {
  'todo.md': '# Todo\n\n## Inbox\n',
  'Physics/Mechanics.md': '# Mechanics\n\nNewton.\n',
}
const button = (label, scope = '//aside') => `::-p-xpath(${scope}//button[normalize-space()="${label}"])`
const editor = '.milkdown .ProseMirror[contenteditable=true]'

flow('a new note opens in the editor, ready to type', { seed }, async page => {
  await click(page, button('+ new note'))
  await page.type('input[placeholder="Folder/Note name"]', 'Ideas')
  const res = await api(page, 'create', () => page.keyboard.press('Enter'))
  assert.deepEqual(res, { status: 200, body: { ok: true, href: '/notes/Ideas.md?edit=1' } })
  await waitForNote(page, 'Ideas.md') // ?edit=1 is dropped from the URL on arrival
  await waitFor(page, editor)
  await page.waitForFunction(() => document.activeElement?.closest('.ProseMirror')) // cursor in the editor
  assert.equal(await fake.read('Ideas.md'), '# Ideas\n\n')
  assert.equal(await lastCommit(), 'create Ideas.md')
})

flow('a new folder shows up with its own "+ new note"', { seed }, async page => {
  await click(page, button('+ new folder'))
  await page.type('input[placeholder="Folder name"]', 'Recipes')
  assert.equal((await api(page, 'create', () => page.keyboard.press('Enter'))).status, 200)
  assert.equal(await fake.read('Recipes/.gitkeep'), '')

  // Empty folders start open, so their "+ new note" is right there.
  const folder = '//aside//details[summary[contains(., "Recipes")]]'
  await click(page, button('+ new note', folder))
  const input = `::-p-xpath(${folder}//input[@placeholder="Note name"])`
  assert.equal(await page.$eval(input, el => el.value), 'Recipes/')
  await page.type(input, 'Pasta')
  assert.equal((await api(page, 'create', () => page.keyboard.press('Enter'))).status, 200)
  await waitForNote(page, 'Recipes/Pasta.md')
  await waitFor(page, editor)
  assert.equal(await fake.read('Recipes/Pasta.md'), '# Pasta\n\n')
  // The tree hides the .gitkeep that holds the folder open.
  assert.equal(await page.$('aside ::-p-text(.gitkeep)'), null)
})

flow('delete a note after confirming', { seed }, async (page, { dialogs }) => {
  await open(page, 'Physics/Mechanics.md')
  assert.equal((await api(page, 'delete', () => click(page, '::-p-text(delete note)'))).status, 200)
  await waitForNote(page, '/notes')
  assert.deepEqual(dialogs, ['Delete the note “Mechanics”? (It stays recoverable in the repo\'s git history.)'])
  assert.equal(await fake.read('Physics/Mechanics.md'), null)
  assert.equal(await lastCommit(), 'delete note: Physics/Mechanics.md')
})

const localDate = page => page.evaluate(() => new Date().toLocaleDateString('sv')) // YYYY-MM-DD

flow('today creates Journal/<date>.md once, then just opens it', { seed }, async page => {
  const date = await localDate(page)
  const path = `Journal/${date}.md`
  assert.equal((await api(page, 'create', () => click(page, button('today')))).status, 200)
  await waitForNote(page, path)
  await waitFor(page, '::-p-xpath(//h3//span[normalize-space()="Today"])')
  const title = new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  })
  assert.equal(await fake.read(path), `# ${title}\n\n## Today\n\n## Notes\n`)

  await open(page, 'todo.md')
  await fake.clearRequests()
  await click(page, button('today'))
  await waitForNote(page, path)
  const { requests } = await fake.requests()
  assert.deepEqual(requests.filter(r => r.method !== 'GET' && r.route !== 'graphql'), [], 'second press must not write')
  assert.equal((await fake.state()).commits.filter(c => c.paths.includes(path)).length, 1)
})

flow('today opens the journal another device already created', { seed }, async page => {
  const path = `Journal/${await localDate(page)}.md`
  await fake.write({ [path]: '# Made on the phone\n' }) // this page's tree doesn't know yet
  assert.equal((await api(page, 'create', () => click(page, button('today')))).status, 200)
  await waitForNote(page, path)
  await waitFor(page, '::-p-text(Made on the phone)')
  assert.equal(await fake.read(path), '# Made on the phone\n')
})

flow('opening a note from the tree shows the progress bar until it arrives', { seed }, async page => {
  await fake.fault({ method: 'GET', path: 'Physics/Mechanics.md', delayMs: 1200, times: 2 })
  await click(page, '::-p-xpath(//aside//summary[contains(., "Physics")])')
  await click(page, 'aside a[href="/notes/Physics/Mechanics.md"]')
  await waitFor(page, '[data-progress]')
  await waitForNote(page, 'Physics/Mechanics.md')
  await waitFor(page, '::-p-text(Newton.)')
  await page.waitForSelector('[data-progress]', { hidden: true })
})
