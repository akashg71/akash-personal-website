import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  attachmentPath,
  checkUpload,
  imageSrc,
  imageType,
  imageUrl,
  imageWidth,
  normalizePath,
  relativeLink,
  resolveEmbed,
  resolveImage,
  sniffImage,
  splitAlt,
  UPLOAD_LIMIT,
} from '@/lib/assets'

const assets = new Map([
  ['attachments/2026-10-04-a.png', 'a1'],
  ['attachments/diagram.png', 'd1'],
  ['Physics/diagram.png', 'd2'],
  ['Physics/img/wave.png', 'w1'],
  ['img/x y.png', 'xy'],
  ['photo.JPG', 'p1'],
  ['deep/er/photo.jpg', 'p2'],
])

describe('vault images', () => {
  test('normalizePath folds . and .. and refuses to leave the vault', () => {
    assert.equal(normalizePath('a/./b/../c'), 'a/c')
    assert.equal(normalizePath('/attachments//x.png'), 'attachments/x.png')
    assert.equal(normalizePath('../x.png'), null)
    assert.equal(normalizePath('a/../../x.png'), null)
    assert.equal(normalizePath('a/..'), null)
  })

  test('markdown images: relative to the note, then from the vault root', () => {
    assert.equal(resolveImage('todo.md', 'attachments/2026-10-04-a.png', assets), 'attachments/2026-10-04-a.png')
    assert.equal(resolveImage('Physics/M.md', '../attachments/2026-10-04-a.png', assets), 'attachments/2026-10-04-a.png')
    assert.equal(resolveImage('Physics/M.md', 'diagram.png', assets), 'Physics/diagram.png', 'the note folder first')
    assert.equal(resolveImage('Physics/M.md', 'attachments/diagram.png', assets), 'attachments/diagram.png', 'then the root')
    assert.equal(resolveImage('Physics/M.md', './img/wave.png', assets), 'Physics/img/wave.png')
    assert.equal(resolveImage('Physics/M.md', '/attachments/diagram.png', assets), 'attachments/diagram.png')
    assert.equal(resolveImage('todo.md', 'img/x%20y.png', assets), 'img/x y.png', 'percent-encoded like Obsidian writes it')
    assert.equal(resolveImage('todo.md', 'img/x y.png?raw=1#top', assets), 'img/x y.png')
  })

  test('markdown images that are not vault files', () => {
    assert.equal(resolveImage('todo.md', 'https://example.com/attachments/diagram.png', assets), null)
    assert.equal(resolveImage('todo.md', '//example.com/x.png', assets), null)
    assert.equal(resolveImage('todo.md', 'data:image/png;base64,AAAA', assets), null)
    assert.equal(resolveImage('todo.md', 'missing.png', assets), null)
    assert.equal(resolveImage('todo.md', '../attachments/diagram.png', assets), null, 'above the vault root')
    assert.equal(resolveImage('todo.md', 'diagram.png', assets), null, 'markdown links never search by name')
    assert.equal(resolveImage('todo.md', 'img/x%zz.png', assets), null, 'a bad escape stays as written')
  })

  test('![[embeds]]: the path as written, else the name anywhere, shortest path first', () => {
    assert.equal(resolveEmbed('todo.md', 'attachments/diagram.png', assets), 'attachments/diagram.png')
    assert.equal(resolveEmbed('Physics/M.md', 'diagram.png', assets), 'Physics/diagram.png', 'next to the note')
    assert.equal(resolveEmbed('Other/N.md', 'diagram.png', assets), 'Physics/diagram.png', 'shortest path')
    assert.equal(resolveEmbed('Other/N.md', 'wave.png', assets), 'Physics/img/wave.png', 'unique name in a subfolder')
    assert.equal(resolveEmbed('todo.md', 'img/wave.png', assets), 'Physics/img/wave.png', 'partial path')
    assert.equal(resolveEmbed('todo.md', 'photo.jpg', assets), 'photo.JPG', 'any case')
    assert.equal(resolveEmbed('todo.md', 'x y.png', assets), 'img/x y.png', 'spaces as written')
    assert.equal(resolveEmbed('todo.md', 'missing.png', assets), null)
    assert.equal(resolveEmbed('todo.md', '../diagram.png', assets), null)
  })

  test('image types come from an allowlist of extensions', () => {
    assert.equal(imageType('a.png'), 'image/png')
    assert.equal(imageType('A.JPG'), 'image/jpeg')
    assert.equal(imageType('x.jpeg'), 'image/jpeg')
    assert.equal(imageType('x.webp'), 'image/webp')
    assert.equal(imageType('x.gif'), 'image/gif')
    assert.equal(imageType('x.svg'), 'image/svg+xml')
    for (const name of ['x.md', 'x.html', 'x.pdf', 'png', '.png', 'dir.png/x', 'x.constructor', 'x.']) {
      assert.equal(imageType(name), null, name)
    }
  })

  test('imageSrc: what view mode loads for each kind of src', () => {
    assert.equal(imageSrc('todo.md', 'https://example.com/a.png', assets), 'https://example.com/a.png')
    assert.equal(imageSrc('todo.md', 'HTTP://example.com/a.png', assets), 'HTTP://example.com/a.png')
    assert.equal(imageSrc('todo.md', '//cdn.example.com/a.png', assets), '//cdn.example.com/a.png')
    assert.equal(imageSrc('Physics/M.md', '../attachments/diagram.png', assets), '/api/notes/blob/d1/diagram.png')
    assert.equal(imageSrc('todo.md', 'attachments/none.png', assets), '', 'missing')
    for (const src of ['data:image/png;base64,AAAA', 'javascript:alert(1)', 'file:///etc/passwd', 'ftp://x/a.png']) {
      assert.equal(imageSrc('todo.md', src, assets), null, src)
    }
  })

  test('image URLs carry the blob sha and the file name', () => {
    assert.equal(imageUrl('img/x y.png', 'abc'), '/api/notes/blob/abc/x%20y.png')
    assert.equal(imageUrl('a#1?.png', 'abc'), '/api/notes/blob/abc/a%231%3F.png')
  })

  test('Obsidian size suffixes set the width', () => {
    assert.equal(imageWidth('300'), 300)
    assert.equal(imageWidth(' 300x200 '), 300)
    assert.equal(imageWidth('0'), undefined)
    assert.equal(imageWidth('wide'), undefined)
    assert.equal(imageWidth('12345'), undefined)
    assert.deepEqual(splitAlt('A diagram|300'), { alt: 'A diagram', width: 300 })
    assert.deepEqual(splitAlt('a|b'), { alt: 'a|b' })
    assert.deepEqual(splitAlt('plain'), { alt: 'plain' })
  })
})

describe('uploads', () => {
  const bytes = (...parts: (string | number[])[]) =>
    Uint8Array.from(parts.flatMap(p => (typeof p === 'string' ? [...p].map(c => c.charCodeAt(0)) : p)))
  const PNG = bytes([0x89], 'PNG\r\n\x1a\n', [0, 0, 0, 13])
  const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0, 0, 16])
  const GIF = bytes('GIF89a', [1, 0])
  const WEBP = bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 ')

  test('the type comes from the bytes, never the name', () => {
    assert.equal(sniffImage(PNG), 'png')
    assert.equal(sniffImage(JPEG), 'jpg')
    assert.equal(sniffImage(GIF), 'gif')
    assert.equal(sniffImage(bytes('GIF87a')), 'gif')
    assert.equal(sniffImage(WEBP), 'webp')
    for (const other of [bytes('<html><script>alert(1)</script>'), bytes('<svg xmlns="http://www.w3.org/2000/svg"/>'), bytes('%PDF-1.7'), bytes('RIFF', [0, 0, 0, 0], 'WAVE'), bytes([0x89], 'PNX'), bytes()]) {
      assert.equal(sniffImage(other), null)
    }
  })

  test('checkUpload: PNG, JPEG, GIF and WebP up to 4,000,000 bytes', () => {
    assert.deepEqual(checkUpload(JPEG), { ext: 'jpg' })
    const max = new Uint8Array(UPLOAD_LIMIT)
    max.set(PNG)
    assert.deepEqual(checkUpload(max), { ext: 'png' })
    const over = new Uint8Array(UPLOAD_LIMIT + 1)
    over.set(PNG)
    assert.equal((checkUpload(over) as { status: number }).status, 413)
    assert.equal((checkUpload(bytes('<html>')) as { status: number }).status, 415)
    assert.equal((checkUpload(bytes()) as { status: number }).status, 400)
  })

  test('attachment paths: dated, slugged, numbered when taken', () => {
    assert.equal(attachmentPath('2026-10-04', 'Screenshot 2026-10-04 at 10.12.PNG', 'png'), 'attachments/2026-10-04-screenshot-2026-10-04-at-10-12.png')
    assert.equal(attachmentPath('2026-10-04', 'image.png', 'webp', 2), 'attachments/2026-10-04-image-2.webp')
    assert.equal(attachmentPath('2026-10-04', 'Café Ünïcode.jpeg', 'jpg'), 'attachments/2026-10-04-cafe-unicode.jpg')
    assert.equal(attachmentPath('2026-10-04', '???.png', 'png'), 'attachments/2026-10-04-image.png')
    assert.equal(attachmentPath('2026-10-04', '', 'gif'), 'attachments/2026-10-04-image.gif')
    assert.equal(attachmentPath('2026-10-04', '../../etc/passwd', 'png'), 'attachments/2026-10-04-passwd.png')
    assert.equal(attachmentPath('2026-10-04', `${'a'.repeat(59)} b.png`, 'png'), `attachments/2026-10-04-${'a'.repeat(59)}.png`)
  })

  test('links are relative to the note and resolve back to the file', () => {
    const cases: [note: string, path: string, link: string][] = [
      ['todo.md', 'attachments/a.png', 'attachments/a.png'],
      ['Physics/Mechanics.md', 'attachments/a.png', '../attachments/a.png'],
      ['A/B/C.md', 'attachments/a.png', '../../attachments/a.png'],
      ['attachments/n.md', 'attachments/a.png', 'a.png'],
      ['My Notes/x.md', 'img/x y.png', '../img/x%20y.png'],
    ]
    for (const [note, path, link] of cases) {
      assert.equal(relativeLink(note, path), link)
      assert.equal(resolveImage(note, link, new Map([[path, 'sha']])), path)
    }
  })
})
