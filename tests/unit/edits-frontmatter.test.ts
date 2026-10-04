import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addSection,
  addToSection,
  deleteSection,
  deleteTask,
  lastReviewed,
  patchTask,
  renameHeading,
  renameTask,
  stampReview,
} from '@/lib/notes'
import { eachEol } from './helpers'

// YAML that reads like markdown: a heading, a task and a review stamp. Line 4
// is byte for byte the nested task on line 12.
const FM = '---\n# Obsidian properties\ntemplate: |\n  - [ ] call mum\nLast reviewed: 2026-01-01\n---\n'
const NOTE = `${FM}# Todo\n\n## Inbox\n\n- [ ] plan week\n  - [ ] call mum\n- [ ] buy milk\n`
// The nested task was ticked off and deleted on another device.
const GONE = NOTE.replace('  - [ ] call mum\n- [ ] buy', '- [ ] buy')

const tick = (line: number, raw: string) => (c: string, cr: string) => {
  const r = patchTask(c, line, raw + cr, true)
  return r.kind === 'patched' ? r.content : null
}
const ref = (line: number, raw: string, cr: string) => ({ line, raw: raw + cr })

describe('line edits skip the frontmatter', () => {
  test('ticking changes only the task below the frontmatter', () => {
    assert.equal(eachEol(NOTE, tick(12, '  - [ ] call mum')), NOTE.replace('  - [ ] call mum\n- [ ] buy', '  - [x] call mum\n- [ ] buy'))
  })

  test('a task-like line in the YAML is never ticked, renamed or deleted', () => {
    assert.equal(eachEol(GONE, tick(12, '  - [ ] call mum')), null)
    assert.equal(eachEol(GONE, tick(4, '  - [ ] call mum')), null)
    assert.equal(eachEol(GONE, (c, cr) => renameTask(c, 12, '  - [ ] call mum' + cr, 'x')), null)
    assert.equal(eachEol(GONE, (c, cr) => deleteTask(c, 12, '  - [ ] call mum' + cr)), null)
  })

  test('a "# comment" in the YAML is not a section', () => {
    const yamlComment = (cr: string) => ref(2, '# Obsidian properties', cr)
    assert.equal(eachEol(NOTE, (c, cr) => renameHeading(c, yamlComment(cr), 'x')), null)
    assert.equal(eachEol(NOTE, (c, cr) => addToSection(c, yamlComment(cr), 'x')), null)
    assert.equal(eachEol(NOTE, (c, cr) => deleteSection(c, yamlComment(cr))), null)
    assert.equal(eachEol(`${FM}# Todo\n`, c => addSection(c, 'Obsidian properties')), `${FM}# Todo\n\n## Obsidian properties\n`)
  })

  test('section edits leave the YAML bytes alone', () => {
    const inbox = (cr: string) => ref(9, '## Inbox', cr)
    assert.equal(eachEol(NOTE, (c, cr) => addToSection(c, inbox(cr), 'new')), `${NOTE}- [ ] new\n`)
    assert.equal(eachEol(NOTE, (c, cr) => renameHeading(c, inbox(cr), 'Later')), NOTE.replace('## Inbox', '## Later'))
    assert.equal(eachEol(NOTE, (c, cr) => deleteSection(c, inbox(cr))), `${FM}# Todo\n`)
    assert.equal(eachEol(NOTE, c => addSection(c, 'Reading')), NOTE.replace('## Inbox', '## Reading\n\n## Inbox'))
  })

  test('a frontmatter-only note gets its first section after the YAML', () => {
    assert.equal(eachEol('---\na: 1\n---\n', c => addSection(c, 'Today')), '---\na: 1\n---\n\n## Today\n')
    assert.equal(eachEol('---\na: 1\n---', c => addSection(c, 'Today')), '---\na: 1\n---\n\n## Today\n')
  })
})

describe('review stamp with frontmatter', () => {
  const stamp = (c: string) => stampReview(c, '2026-10-04')

  test('lastReviewed ignores a "Last reviewed:" key in the YAML', () => {
    assert.equal(lastReviewed(NOTE), null)
    assert.equal(lastReviewed(`${FM}# Todo\n\nLast reviewed: 2026-09-27\n`), '2026-09-27')
  })

  test('stampReview adds the stamp under the real H1 and leaves the YAML alone', () => {
    assert.equal(eachEol(NOTE, stamp), NOTE.replace('# Todo\n', '# Todo\n\nLast reviewed: 2026-10-04\n'))
    assert.equal(eachEol(`${FM}Todo\n====\n## A\n`, stamp), `${FM}Todo\n====\n\nLast reviewed: 2026-10-04\n\n## A\n`)
  })

  test('stampReview replaces the stamp in the body, never the YAML key', () => {
    const md = `${FM}# Todo\n\nLast reviewed: 2026-09-27\n`
    assert.equal(eachEol(md, stamp), `${FM}# Todo\n\nLast reviewed: 2026-10-04\n`)
  })

  test('with no H1 the stamp goes right after the frontmatter', () => {
    assert.equal(eachEol('---\na: 1\n---\n## A\n', stamp), '---\na: 1\n---\n\nLast reviewed: 2026-10-04\n\n## A\n')
    assert.equal(eachEol('---\na: 1\n---\n\n## A\n', stamp), '---\na: 1\n---\n\nLast reviewed: 2026-10-04\n\n## A\n')
    assert.equal(eachEol('---\na: 1\n---\n', stamp), '---\na: 1\n---\n\nLast reviewed: 2026-10-04\n')
    assert.equal(eachEol('---\na: 1\n---', stamp), '---\na: 1\n---\n\nLast reviewed: 2026-10-04')
  })

  test('a BOM stays the first character', () => {
    assert.equal(eachEol('\uFEFF---\na: 1\n---\n## A\n', stamp), '\uFEFF---\na: 1\n---\n\nLast reviewed: 2026-10-04\n\n## A\n')
    assert.equal(eachEol('\uFEFF## A\n', stamp), '\uFEFFLast reviewed: 2026-10-04\n\n## A\n')
  })
})
