// Images: vault files and ![[embeds]] in view mode through the session-checked
// image route.
import assert from 'node:assert/strict'
import { BASE_URL, flow, open } from '../harness.mjs'

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
