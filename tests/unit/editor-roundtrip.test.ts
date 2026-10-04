// A rich-editor save must write back what it read. These run the editor's
// real Crepe set-up (app/notes/editor/configure.ts) headless and compare the
// markdown a save would write with the file that was opened.
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { closeWindow, roundTrip } from './crepe-harness'
import { crlf } from './helpers'

after(closeWindow)

const fixture = readFileSync(new URL('../fixtures/rich-roundtrip.md', import.meta.url), 'utf8')

// What a save still rewrites in the fixture. Each renders the same.
const FIXTURE_REWRITES: [from: string, to: string][] = [
  // GFM tables are re-padded so the pipes line up.
  [
    '| Item | Cost |\n| --- | --- |\n| Rent | $2,400 |\n| Food | $300 |',
    '| Item | Cost   |\n| ---- | ------ |\n| Rent | $2,400 |\n| Food | $300   |',
  ],
]

test('a feature-dense note saves byte for byte, apart from the listed rewrites', async () => {
  const expected = FIXTURE_REWRITES.reduce((md, [from, to]) => {
    assert.ok(md.includes(from), `fixture lacks ${JSON.stringify(from)}`)
    return md.replace(from, to)
  }, fixture)
  const saved = await roundTrip(fixture)
  assert.equal(saved, expected)
  assert.equal(await roundTrip(saved), saved, 'a second save changes nothing')
  assert.equal(await roundTrip(crlf(fixture)), expected, 'CRLF endings come back as LF')
})

test('images keep their alt text, title and place', async () => {
  for (const md of [
    'Text ![i](a.png) more\n',
    '![A diagram of attention](attachments/attn.png)\n',
    '![](attachments/untitled.png)\n',
    '![alt](attachments/a.png "Caption here")\n',
    'Two ![a](a.png) and ![b](b.png "B") inline\n',
  ]) {
    assert.equal(await roundTrip(md), md)
  }
})

test('with ImageBlock on, a block image keeps its alt text instead of a resize ratio', async () => {
  const imageBlock = { 'image-block': true } as const
  for (const md of [
    '![A diagram](attachments/x.png)\n',
    '![](attachments/x.png)\n',
    '![Captioned](attachments/c.png "A caption")\n',
    'Inline ![icon](attachments/i.png) too\n',
  ]) {
    assert.equal(await roundTrip(md, imageBlock), md)
  }
})

test('code fences keep their whole info string', async () => {
  for (const md of [
    '```ts title="hello.ts"\nconst a = 1\n```\n',
    '```python {linenos=true}\nprint(1)\n```\n',
    '```latex\n\\documentclass{article}\n```\n',
    '```\nno language\n```\n',
    '````md\n```js\nnested\n```\n````\n',
  ]) {
    assert.equal(await roundTrip(md), md)
  }
})

// Rewrites a save still makes. None changes what the note says; they are
// listed so a change in Crepe shows up here.
test('documented rewrites', async () => {
  const cases: [input: string, saved: string][] = [
    ['- [ ] a\r\n- [ ] b\r\n', '- [ ] a\n- [ ] b\n'], // CRLF becomes LF
    ['- a\n\t- b\n', '- a\n  - b\n'], // tab-indented lists (Obsidian's default) get spaces
    ['* a\n* b\n', '- a\n- b\n'], // every bullet is "-"
    ['Title\n=====\n', '# Title\n'], // setext headings become ATX
    ['see https://example.com now\n', 'see <https://example.com> now\n'], // bare URLs get brackets
    ['Fish &amp; chips\n', 'Fish & chips\n'], // entities are decoded
    ['a\n\n\n\nb\n', 'a\n\nb\n'], // runs of blank lines shrink to one
    ['line  \nbreak\n', 'line\\\nbreak\n'], // a two-space hard break becomes "\"
    ['para\n\n    code\n', 'para\n\n```\ncode\n```\n'], // indented code becomes fenced
    ['no final newline', 'no final newline\n'],
  ]
  for (const [input, saved] of cases) {
    assert.equal(await roundTrip(input), saved, JSON.stringify(input))
  }
})
