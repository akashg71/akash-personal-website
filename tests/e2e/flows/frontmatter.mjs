// YAML frontmatter: never rendered as a rule and headings, and never touched
// by the line edits below it.
import assert from 'node:assert/strict'
import { api, click, fake, flow, open, waitFor } from '../harness.mjs'

// The YAML repeats the task below it, and has a "# heading" line.
const NOTE = `---
title: Project Atlas
tags: [work, planning, q4, travel]
status: active
due: 2026-10-10
budget: 2400
public: false
link: https://example.com/atlas
aliases:
  - Atlas
template: |
  - [ ] Call the bank
  # not a heading
---
# Project Atlas

## Next

- [ ] Call the bank
- [ ] Draft the brief
`
const seed = { 'todo.md': '# Todo\n', 'Projects/Atlas.md': NOTE }
const box = title => `input[type=checkbox][aria-label="${title}"]`

flow('frontmatter never renders as a rule and headings', { seed }, async page => {
  await open(page, 'Projects/Atlas.md')
  await waitFor(page, box('Call the bank'))
  assert.doesNotMatch(await page.$eval('main section', el => el.innerText), /title: Project Atlas|not a heading/)
  assert.equal((await page.$$('main section hr')).length, 0)
  assert.equal((await page.$$(box('Call the bank'))).length, 1)
})

flow('ticking a task below the frontmatter changes exactly that line', { seed }, async page => {
  await open(page, 'Projects/Atlas.md')
  assert.equal((await api(page, 'toggle', () => click(page, box('Call the bank')))).status, 200)
  assert.equal(await fake.read('Projects/Atlas.md'), NOTE.replace('- [ ] Call the bank\n- [ ] Draft', '- [x] Call the bank\n- [ ] Draft'))
})

flow('the weekly review stamp goes under the H1, never into the YAML', {
  seed: { 'todo.md': '---\ncssclasses: [wide]\nLast reviewed: 2026-01-01\n---\n# Todo\n\n## Inbox\n' },
}, async page => {
  await waitFor(page, '::-p-text(No weekly review recorded yet.)')
  const today = await page.evaluate(() => new Date().toLocaleDateString('sv')) // YYYY-MM-DD, local
  assert.equal((await api(page, 'review', () => click(page, '::-p-text(mark reviewed)'))).status, 200)
  await waitFor(page, '::-p-text(Reviewed today.)')
  assert.equal(
    await fake.read('todo.md'),
    `---\ncssclasses: [wide]\nLast reviewed: 2026-01-01\n---\n# Todo\n\nLast reviewed: ${today}\n\n## Inbox\n`,
  )
})
