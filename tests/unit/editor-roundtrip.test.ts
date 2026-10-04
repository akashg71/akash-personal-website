// A rich-editor save must write back what it read. These run the editor's
// real Crepe set-up (app/notes/editor/configure.ts) headless and compare the
// markdown a save would write with the file that was opened.
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { uploadConfig } from '@milkdown/kit/plugin/upload'
import { closeWindow, openEditor, roundTrip } from './crepe-harness'
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

test('images show through display(); pasted ones save as plain links to the stored file', async () => {
  const shown: string[] = []
  const images = {
    upload: async (file: File) => {
      if (file.name === 'bad.png') throw new Error('refused') // the plugin must still settle
      return `../attachments/2026-10-04-${file.name}`
    },
    display: (src: string) => (shown.push(src), `/shown/${src}`),
  }
  const editor = await openEditor('Intro\n\n![A wave](../attachments/wave.png)\n', undefined, images)
  try {
    assert.deepEqual(shown, ['../attachments/wave.png'], 'display() gets the src as written')
    const files = ['pasted.png', 'notes.txt', 'bad.png'].map(name => new File(['x'], name, { type: name.endsWith('.txt') ? 'text/plain' : 'image/png' }))
    const nodes = await editor.crepe.editor.action(ctx => {
      const { uploader } = ctx.get(uploadConfig.key)
      return uploader(files as unknown as FileList, editor.view().state.schema, ctx, 0) as Promise<ProseNode[]>
    })
    editor.cursorAfter('Intro')
    const view = editor.view()
    view.dispatch(view.state.tr.insert(view.state.selection.from, nodes))
    assert.equal(editor.markdown(), 'Intro![](../attachments/2026-10-04-pasted.png)\n\n![A wave](../attachments/wave.png)\n')
  } finally {
    await editor.close()
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

test('wiki links and embeds save as written, escaped and code ones stay text', async () => {
  for (const md of [
    'See [[Note]], [[Physics/Waves|waves]] and [[Mechanics#Energy]].\n',
    '[[snake_case_note]] and [[#Local heading]]\n',
    'An embed ![[diagram.png|300]] inline\n',
    'Not links: \\[\\[escaped]] and `[[in code]]`\n',
    '\\[\\[x]] `code`\n',
    '- [ ] Read [[Waves]] 📅 2026-10-10\n',
    '```\n[[in a fence]]\n```\n',
    '| Note                | Status |\n| ------------------- | ------ |\n| [[Mechanics\\|mech]] | done   |\n',
  ]) {
    assert.equal(await roundTrip(md), md, JSON.stringify(md))
  }
})

test('typing [[x]] makes a link, except inside inline code', async () => {
  const editor = await openEditor('Start here\n\nSome `code` there\n')
  try {
    editor.cursorAfter('here')
    editor.type(' [[Physics/Waves|waves]] and ![[d.png]]')
    editor.cursorAfter('cod')
    editor.type(' [[y]]')
    let links = 0
    editor.view().state.doc.descendants(node => {
      if (node.type.name === 'wikiLink') links++
    })
    assert.equal(links, 2)
    assert.equal(editor.markdown(), 'Start here [[Physics/Waves|waves]] and ![[d.png]]\n\nSome `cod [[y]]e` there\n')
  } finally {
    await editor.close()
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
    ['[[]] and [x]\n', '\\[\\[]] and \\[x]\n'], // brackets that are not a link get a backslash
  ]
  for (const [input, saved] of cases) {
    assert.equal(await roundTrip(input), saved, JSON.stringify(input))
  }
})
