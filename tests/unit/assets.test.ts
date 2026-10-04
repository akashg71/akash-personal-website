import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { imageType, imageUrl, imageWidth, normalizePath, resolveEmbed, resolveImage, splitAlt } from '@/lib/assets'

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
