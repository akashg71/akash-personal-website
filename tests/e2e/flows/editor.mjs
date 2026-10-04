// Rich (Milkdown Crepe) and source editors: typing, saving, the markdown
// round-trip (invariant 4), and a save that conflicts with another device.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { api, click, fake, flow, noteUrl, open, waitFor } from '../harness.mjs'

const DENSE = `# Dense note

Intro with **bold**, *italic*, ~~struck~~, \`code\` and a [link](https://example.com).
A snake_case name like a_b and file_name_v2 stays readable.
Prices: $30 today, $2,400 next month, 50% off.

## Tasks

- [ ] Open task
- [x] Done task
  - [ ] Nested task

## Lists

- Plain bullet
  - Nested bullet
- Second bullet

3. Third
4. Fourth

> A quote with **bold** inside.

### Small heading ✅

Line one\\
line two, an <b>inline tag</b>, ~5 and _emphasis_.

\`\`\`ts
const x = 1 // # not a heading
\`\`\`

| Name | Value |
| ---- | ----- |
| a    | 1     |
| b    | 2     |

---

Last reviewed: 2026-10-01

Last line.
`
// The one documented rewrite (handover §7): Crepe escapes intraword underscores.
const documented = md => md.replace(/(?<=\w)_(?=\w)/g, '\\_')

const button = label => `::-p-xpath(//button[normalize-space()="${label}"])`
const writes = async () => (await fake.requests()).requests.filter(r => r.method !== 'GET' && r.route !== 'graphql') // GraphQL only reads

/**
 * Open `path` straight in the rich editor (?edit=1, as new notes do). The app
 * focuses the editor only once Crepe is ready — typing earlier would race the
 * editor's first serialization.
 */
async function editNote(page, path) {
  await page.goto(`${noteUrl(path)}?edit=1`)
  await page.waitForFunction(() => document.activeElement?.closest('.ProseMirror'))
}

/**
 * Wait until the editor DOM has been still for 100ms. Crepe renders list items
 * with Vue views that keep re-rendering briefly after they appear, and each
 * render can move the cursor: keys typed meanwhile land out of order, and a
 * note with lists opens with the cursor back at the top. A person never types
 * that fast; the suite has to wait for it.
 */
const settle = page => page.$eval('.milkdown .ProseMirror', root => new Promise(resolve => {
  const done = () => {
    observer.disconnect()
    clearTimeout(cap)
    resolve()
  }
  let quiet = setTimeout(done, 100)
  const cap = setTimeout(done, 3000)
  const observer = new MutationObserver(() => {
    clearTimeout(quiet)
    quiet = setTimeout(done, 100)
  })
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true })
}))

/** Click the end of the last paragraph, as a person would, and check the cursor stays there. */
async function caretAtEnd(page) {
  await settle(page)
  const last = await page.$('.milkdown .ProseMirror > p:last-of-type')
  const { width, height } = await last.boundingBox()
  await last.click({ offset: { x: width - 4, y: height / 2 } }) // scrolls it into view first
  await settle(page)
  await page.waitForFunction(p => {
    const { anchorNode: node, anchorOffset: at } = getSelection()
    return (node?.nodeType === Node.TEXT_NODE && p.contains(node) && at === node.length) || (node === p && at === p.childNodes.length)
  }, {}, last)
}

// ProseMirror garbles zero-delay typing.
const typeSlowly = (page, text) => page.keyboard.type(text, { delay: 35 })

async function pressSave(page) {
  await page.keyboard.down('Meta')
  await page.keyboard.press('s')
  await page.keyboard.up('Meta')
}

flow('rich editor: typing a paragraph and a list saves the expected markdown', {
  seed: { 'Physics/Mechanics.md': "# Mechanics\n\nNewton's laws.\n" },
}, async page => {
  await editNote(page, 'Physics/Mechanics.md')
  await caretAtEnd(page)
  await page.keyboard.press('Enter')
  await typeSlowly(page, 'Momentum is conserved.')
  await page.keyboard.press('Enter')
  await typeSlowly(page, '- ')
  await settle(page)
  await typeSlowly(page, 'first')
  await page.keyboard.press('Enter')
  await settle(page)
  await typeSlowly(page, 'second')
  assert.equal((await api(page, 'save', () => click(page, button('save')))).status, 200)
  await waitFor(page, '::-p-text(Momentum is conserved.)')
  assert.equal(await fake.read('Physics/Mechanics.md'), "# Mechanics\n\nNewton's laws.\n\nMomentum is conserved.\n\n- first\n- second\n")
  assert.equal((await fake.state()).commits[0].message, 'edit: Physics/Mechanics.md')
})

flow('rich editor: ⌘S straight after typing saves the last keystrokes', {
  seed: { 'Physics/Mechanics.md': "# Mechanics\n\nNewton's laws.\n" },
}, async page => {
  await editNote(page, 'Physics/Mechanics.md')
  await caretAtEnd(page)
  // No pause: the editor reports a change only once typing stops for 200 ms.
  await typeSlowly(page, ' Then energy.')
  assert.equal((await api(page, 'save', () => pressSave(page))).status, 200)
  assert.equal(await fake.read('Physics/Mechanics.md'), "# Mechanics\n\nNewton's laws. Then energy.\n")
})

flow('rich editor: switching to source straight after typing keeps the last keystrokes', {
  seed: { 'Physics/Mechanics.md': "# Mechanics\n\nNewton's laws.\n" },
}, async page => {
  await editNote(page, 'Physics/Mechanics.md')
  await caretAtEnd(page)
  await typeSlowly(page, ' Then energy.')
  await click(page, button('source'))
  assert.equal(await page.$eval('textarea', el => el.value), "# Mechanics\n\nNewton's laws. Then energy.\n")
})

flow('rich editor: saving a feature-dense note changes only what is documented', {
  seed: { 'Dense.md': DENSE },
}, async page => {
  await editNote(page, 'Dense.md')
  await caretAtEnd(page)
  await typeSlowly(page, ' Saved.')
  assert.equal((await api(page, 'save', () => click(page, button('save')))).status, 200)
  assert.equal(await fake.read('Dense.md'), documented(DENSE).replace('Last line.', 'Last line. Saved.'))
})

flow('an untouched dense note: the editor shows only the documented change, done writes nothing', {
  seed: { 'Dense.md': DENSE },
}, async page => {
  await editNote(page, 'Dense.md')
  await click(page, button('source'))
  assert.equal(await page.$eval('textarea', el => el.value), documented(DENSE))
  await click(page, button('done'))
  await waitFor(page, button('✎ Edit'))
  assert.deepEqual(await writes(), [])
  assert.equal(await fake.read('Dense.md'), DENSE)
})

flow('✎ Edit opens the rich editor; done without changes writes nothing', {
  seed: { 'Dense.md': DENSE },
}, async page => {
  await open(page, 'Dense.md')
  await click(page, button('✎ Edit'))
  await waitFor(page, '.milkdown .ProseMirror ::-p-text(Last line.)')
  await click(page, button('done'))
  await waitFor(page, button('✎ Edit'))
  assert.deepEqual(await writes(), [])
})

const WEBSITE = '# Website\n\n## Ideas\n\n- [ ] Dark mode\n'

flow('source tab: edit the raw markdown and save with ⌘S', { seed: { 'Projects/Website.md': WEBSITE } }, async page => {
  await editNote(page, 'Projects/Website.md')
  await click(page, button('source'))
  await page.$eval('textarea', el => el.setSelectionRange(el.value.length, el.value.length))
  await page.type('textarea', '- [ ] Offline reading\n')
  assert.equal((await api(page, 'save', () => pressSave(page))).status, 200)
  await waitFor(page, 'input[type=checkbox][aria-label="Offline reading"]')
  assert.equal(await fake.read('Projects/Website.md'), `${WEBSITE}- [ ] Offline reading\n`)
})

flow('a save that conflicts with another device is refused and the draft kept', {
  seed: { 'Projects/Website.md': WEBSITE },
  allow: [[409, '/api/notes/save']],
}, async page => {
  await editNote(page, 'Projects/Website.md')
  await click(page, button('source'))
  await page.$eval('textarea', el => el.setSelectionRange(el.value.length, el.value.length))
  await page.type('textarea', '- [ ] My draft line\n')
  const phone = `${WEBSITE}- [ ] Added on the phone\n`
  await fake.write({ 'Projects/Website.md': phone })

  assert.equal((await api(page, 'save', () => click(page, button('save')))).status, 409)
  await waitFor(page, '[role=alert]::-p-text(changed since you opened the editor)')
  assert.equal(await page.$eval('textarea', el => el.value), `${WEBSITE}- [ ] My draft line\n`)
  assert.equal(await fake.read('Projects/Website.md'), phone)
})

const IMAGES = `# Images

Text ![i](../attachments/i.png) more.

![](../attachments/untitled.png)

![A diagram](../attachments/diagram.png "Attention")

Last line.
`

flow('rich editor keeps images: untitled ones, alt text and titles', {
  seed: { 'Images.md': IMAGES },
  // The editor shows the images, and the test vault has no image files.
  allow: ['i', 'untitled', 'diagram'].map(name => [404, `/attachments/${name}.png`]),
}, async page => {
  await editNote(page, 'Images.md')
  await caretAtEnd(page)
  await typeSlowly(page, ' Saved.')
  assert.equal((await api(page, 'save', () => click(page, button('save')))).status, 200)
  assert.equal(await fake.read('Images.md'), IMAGES.replace('Last line.', 'Last line. Saved.'))
})

const LINKS = `# Links

See [[Physics/Mechanics]], [[Mechanics#Energy|energy]] and [[snake_case_note]].

An embed ![[diagram.png|300]] and \\[\\[not a link]].

Last line.
`

flow('rich editor keeps [[wiki links]] and ![[embeds]]; typing [[x]] makes a link, but not in code', {
  seed: { 'Links.md': LINKS },
}, async page => {
  await editNote(page, 'Links.md')
  await waitFor(page, '.wikilink[data-value="Mechanics#Energy|energy"]::-p-text(energy)')
  await caretAtEnd(page)
  await typeSlowly(page, ' Next [[Waves]] and `[[code]]`.')
  await waitFor(page, '.wikilink[data-value="Waves"]')
  assert.equal((await api(page, 'save', () => click(page, button('save')))).status, 200)
  assert.equal(await fake.read('Links.md'), LINKS.replace('Last line.', 'Last line. Next [[Waves]] and `[[code]]`.'))
})

// Rewrites found while building this suite (2026-10-04); not fixed yet. Each
// becomes a flow above once the editor keeps that construct byte-for-byte.
// The first is the deferred escapes fix (wrap the text handler, RT step 4).
test.todo('rich editor keeps a_b, "R&D", line-start #tags and [brackets]: today a\\_b, R\\&D, \\#tag and \\[x]')
test.todo('rich editor keeps bare URLs and "5 * 3": today <url> and 5 \\* 3')
test.todo('rich editor keeps "* " / "1)" markers, setext headings and two-space line breaks')
