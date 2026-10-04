// Images: vault files and ![[embeds]] in view mode through the session-checked
// image route, the upload endpoint, and picking or pasting images in the editor.
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { api, BASE_URL, click, fake, flow, noteUrl, open, PASSWORD } from '../harness.mjs'

// An 8x6 red PNG.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAEUlEQVR4nGM4YaOBFTEMpAQAmkY4QXj/pr4AAAAASUVORK5CYII='

const isImageRoute = url => new URL(url).pathname.startsWith('/api/notes/blob/')

/** Every image in the note once it has loaded (or failed). */
const images = page => page.$$eval('main section img', imgs => imgs.map(img => ({
  src: img.getAttribute('src'),
  alt: img.alt,
  width: img.getAttribute('width'),
  loaded: img.complete && img.naturalWidth > 0,
  link: img.closest('a')?.getAttribute('href') ?? null,
})))

flow('view mode shows vault images and ![[embeds]]; the image route needs a session', {
  seed: {
    'todo.md': '# Todo\n',
    'Physics/Waves.md': [
      '# Waves',
      '',
      '![A wave](../attachments/wave.png)',
      '',
      'Inline ![[wave.png|120]] embed, a [linked ![icon](/attachments/wave.png)](https://example.com) and ![[gone.png]].',
      '',
      '![Missing](pics/none.png) and [[Mechanics]] stays text.',
      '',
    ].join('\n'),
    'attachments/wave.png': { base64: PNG },
  },
}, async page => {
  const served = []
  page.on('response', res => isImageRoute(res.url()) && served.push(res))
  await open(page, 'Physics/Waves.md')
  await page.waitForFunction(() => [...document.querySelectorAll('main section img')].every(i => i.complete))

  const imgs = await images(page)
  assert.equal(imgs.length, 3, JSON.stringify(imgs))
  assert.ok(imgs.every(i => i.loaded && isImageRoute(BASE_URL + i.src)), JSON.stringify(imgs))
  assert.equal(new Set(imgs.map(i => i.src)).size, 1, 'one file, one URL')
  assert.deepEqual(imgs.map(i => [i.alt, i.width]), [['A wave', null], ['wave.png', '120'], ['icon', null]])
  assert.deepEqual(imgs.map(i => i.link), [imgs[0].src, imgs[0].src, 'https://example.com'], 'tap opens it full size, unless it is a link')

  const res = served.find(r => r.status() === 200)
  assert.ok(res, `image route answers: ${served.map(r => r.status())}`)
  const headers = res.headers()
  assert.equal(headers['content-type'], 'image/png')
  assert.match(headers['cache-control'], /private.*immutable/)
  assert.match(headers['content-security-policy'], /sandbox/)
  assert.equal(headers['x-content-type-options'], 'nosniff')

  const text = await page.$eval('main section', el => el.textContent)
  assert.ok(text.includes('missing image: gone.png') && text.includes('missing image: pics/none.png'), text)
  assert.ok(text.includes('[[Mechanics]] stays text'), text)
  assert.equal(await page.$('::-p-xpath(//aside//summary[contains(., "attachments")])'), null, 'a folder of images alone stays out of the tree')

  // Signed out: 401. Signed in with the cached version: 304, without asking GitHub.
  const url = BASE_URL + imgs[0].src
  assert.equal((await fetch(url)).status, 401)
  const cookie = (await page.browserContext().cookies()).map(c => `${c.name}=${c.value}`).join('; ')
  const etag = headers.etag
  assert.equal((await fetch(url, { headers: { cookie, 'if-none-match': etag } })).status, 304)
})

async function session() {
  const res = await fetch(`${BASE_URL}/api/notes/login`, { method: 'POST', body: new URLSearchParams({ password: PASSWORD }), redirect: 'manual' })
  return res.headers.getSetCookie().find(c => c.startsWith('notes_session='))?.split(';')[0]
}

const upload = (cookie, bytes, query) => fetch(`${BASE_URL}/api/notes/upload?${new URLSearchParams(query)}`, {
  method: 'POST',
  headers: { cookie, 'content-type': 'image/png' },
  body: bytes,
})

test('an upload commits the image under attachments/ and answers its link', async () => {
  await fake.reset({ 'Physics/Waves.md': '# Waves\n' })
  const cookie = await session()
  const png = Buffer.from(PNG, 'base64')
  const query = { note: 'Physics/Waves.md', name: 'Wave Diagram.PNG', date: '2026-10-04' }

  const first = await upload(cookie, png, query)
  assert.equal(first.status, 200)
  const { path, src } = await first.json()
  assert.deepEqual({ path, src }, { path: 'attachments/2026-10-04-wave-diagram.png', src: '../attachments/2026-10-04-wave-diagram.png' })
  assert.deepEqual(await fake.bytes(path), png, 'the bytes as sent')
  assert.deepEqual((await fake.state()).commits[0].paths, [path], 'one commit')

  const second = await (await upload(cookie, png, query)).json()
  assert.equal(second.path, 'attachments/2026-10-04-wave-diagram-2.png', 'a taken name gets -2')
  const img = await fetch(BASE_URL + second.url, { headers: { cookie } })
  assert.equal(img.headers.get('content-type'), 'image/png')
  assert.deepEqual(Buffer.from(await img.arrayBuffer()), png)

  const big = Buffer.alloc(4_000_001)
  png.copy(big)
  assert.equal((await upload(cookie, big, query)).status, 413)
  assert.equal((await upload(cookie, Buffer.from('<html><script>alert(1)</script>'), { ...query, name: 'evil.png' })).status, 415)
  assert.equal((await upload(cookie, png, { name: 'x.png' })).status, 400, 'no note to link from')
  assert.equal((await fake.state()).commits.length, 3, 'refused uploads commit nothing')
})

const saveButton = '::-p-xpath(//button[normalize-space()="save"])'

/** Open `path` in the rich editor, focused at the end of the note. */
async function editNote(page, path) {
  await page.goto(`${noteUrl(path)}?edit=1`)
  await page.waitForFunction(() => document.activeElement?.closest('.ProseMirror'))
}

/** Save, then wait for view mode to show `count` images, all loaded from the image route. */
async function saveAndView(page, count) {
  const served = []
  page.on('response', res => isImageRoute(res.url()) && served.push(res))
  assert.equal((await api(page, 'save', () => click(page, saveButton))).status, 200)
  await page.waitForFunction(n => {
    const imgs = [...document.querySelectorAll('main section img')]
    return imgs.length === n && imgs.every(i => i.complete && i.naturalWidth > 0)
  }, {}, count)
  const ok = served.filter(r => r.status() === 200 && /^image\/(png|webp)$/.test(r.headers()['content-type']))
  assert.ok(ok.length, `view mode loads from the image route: ${served.map(r => r.status())}`)
}

flow('pick an image in the editor: it uploads, saves as a plain link and shows in view mode', {
  seed: { 'todo.md': '# Todo\n', 'Physics/Waves.md': '# Waves\n\nSome text.\n' },
}, async page => {
  const file = join(mkdtempSync(join(tmpdir(), 'notes-e2e-')), 'Wave Photo.png')
  writeFileSync(file, Buffer.from(PNG, 'base64'))
  await editNote(page, 'Physics/Waves.md')
  // The top bar's image button: icon only, so found by its icon.
  const imageButton = await page.waitForFunction(() =>
    [...document.querySelectorAll('.milkdown-top-bar button')].find(b => b.innerHTML.includes('M19 5V19H5V5H19Z')))
  await imageButton.asElement().click()
  const [chooser] = await Promise.all([page.waitForFileChooser(), click(page, '.milkdown-image-block label.uploader')])
  // Chrome drops this answer's body from its cache, so the repo says where it went.
  assert.equal((await api(page, 'upload', () => chooser.accept([file]))).status, 200)
  const path = (await fake.state()).paths.find(p => p.startsWith('attachments/'))
  assert.match(path, /^attachments\/\d{4}-\d{2}-\d{2}-wave-photo\.png$/)
  assert.deepEqual(await fake.bytes(path), Buffer.from(PNG, 'base64'))
  await page.waitForFunction(() => {
    const img = document.querySelector('.milkdown-image-block img')
    return img?.complete && img.naturalWidth > 0
  })

  await saveAndView(page, 1)
  assert.equal(await fake.read('Physics/Waves.md'), `# Waves\n\nSome text.\n\n![](../${path})\n`)
})

flow('paste a big image into the editor: it is shrunk, uploaded and saved where it was pasted', {
  seed: { 'todo.md': '# Todo\n', 'Ideas.md': '# Ideas\n\nSee this:\n' },
}, async page => {
  await editNote(page, 'Ideas.md')
  const { status, body } = await api(page, 'upload', () => page.evaluate(async () => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 3000, height: 1500 })
    canvas.getContext('2d').fillRect(0, 0, 3000, 1500)
    const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
    const data = new DataTransfer()
    data.items.add(new File([png], 'image.png', { type: 'image/png' }))
    document.querySelector('.ProseMirror').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }))
  assert.equal(status, 200, JSON.stringify(body))
  assert.match(body.src, /^attachments\/\d{4}-\d{2}-\d{2}-image\.webp$/, 'redrawn as WebP')
  await page.waitForFunction(() => document.querySelector('.ProseMirror img')?.naturalWidth > 0)

  await saveAndView(page, 1)
  assert.equal(await fake.read('Ideas.md'), `# Ideas\n\nSee this:![](${body.src})\n`)
  assert.equal(await page.$eval('main section img', img => img.naturalWidth), 2560, 'at most 2560px on its longest side')
})
