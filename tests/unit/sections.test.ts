import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { addSection, addToSection, deleteSection, renameHeading } from '@/lib/notes'
import { eachEol } from './helpers'

// Headings are addressed the way the page sends them: 1-based line + raw line.
const add = (line: number, raw: string) => (c: string, cr: string) => addToSection(c, { line, raw: raw + cr }, 'new')
const remove = (line: number, raw: string) => (c: string, cr: string) => deleteSection(c, { line, raw: raw + cr })
const rename = (line: number, raw: string) => (c: string, cr: string) => renameHeading(c, { line, raw: raw + cr }, 'New')
const section = (title: string) => (c: string) => addSection(c, title)

describe('addToSection', () => {
  test('fills an empty section with one blank line either side', () => {
    assert.equal(eachEol('# Todo\n\n## Today\n\n## Inbox\n', add(3, '## Today')), '# Todo\n\n## Today\n\n- [ ] new\n\n## Inbox\n')
    assert.equal(eachEol('## Today\n\n\n\n## Inbox\n', add(1, '## Today')), '## Today\n\n- [ ] new\n\n## Inbox\n')
    assert.equal(eachEol('## Today\n## Inbox\n', add(1, '## Today')), '## Today\n\n- [ ] new\n\n## Inbox\n')
  })

  test('fills an empty last section, with or without a trailing newline', () => {
    assert.equal(eachEol('## Inbox\n', add(1, '## Inbox')), '## Inbox\n\n- [ ] new\n')
    assert.equal(eachEol('## Inbox\n\n\n', add(1, '## Inbox')), '## Inbox\n\n- [ ] new\n')
    assert.equal(eachEol('# T\n## Inbox', add(2, '## Inbox')), '# T\n## Inbox\n\n- [ ] new')
  })

  test('joins the existing list, matching its bullet and indent', () => {
    assert.equal(eachEol('## A\n- [ ] x\n\n## B\n', add(1, '## A')), '## A\n- [ ] x\n- [ ] new\n\n## B\n')
    assert.equal(eachEol('## A\n  * [x] x\n', add(1, '## A')), '## A\n  * [x] x\n  * [ ] new\n')
    assert.equal(eachEol('## A\n+ [ ] x\n  + [ ] sub\n', add(1, '## A')), '## A\n+ [ ] x\n  + [ ] sub\n+ [ ] new\n')
  })

  test('starts a new list after prose or an ordered list', () => {
    assert.equal(eachEol('## A\nSome words.\n', add(1, '## A')), '## A\nSome words.\n\n- [ ] new\n')
    assert.equal(eachEol('## A\n1. step\n', add(1, '## A')), '## A\n1. step\n\n- [ ] new\n')
  })

  test('appends at the end of the file, with or without a trailing newline', () => {
    assert.equal(eachEol('# T\n## A\n- [ ] x\n', add(2, '## A')), '# T\n## A\n- [ ] x\n- [ ] new\n')
    assert.equal(eachEol('# T\n## A\n- [ ] x', add(2, '## A')), '# T\n## A\n- [ ] x\n- [ ] new')
  })

  test('finds a heading that moved, by its unique text', () => {
    // The page saw "## B" on line 3; a line was added above it since.
    assert.equal(eachEol('## A\nnew line\n\n## B\n', add(3, '## B')), '## A\nnew line\n\n## B\n\n- [ ] new\n')
  })

  test('refuses when the heading moved and its text is not unique, or is gone', () => {
    const md = '# T\n## Notes\n\n## Notes\n'
    assert.equal(eachEol(md, add(1, '## Notes')), null)
    assert.equal(eachEol(md, add(4, '## Notes')), '# T\n## Notes\n\n## Notes\n\n- [ ] new\n')
    assert.equal(eachEol(md, add(2, '## Gone')), null)
  })

  test('a "# comment" in a fenced code block is not a heading', () => {
    const md = '## Setup\n\n```sh\n# install\nnpm i\n```\n\n## Next\n'
    // The section runs past the comment, so the item lands after the block.
    assert.equal(eachEol(md, add(1, '## Setup')), '## Setup\n\n```sh\n# install\nnpm i\n```\n\n- [ ] new\n\n## Next\n')
    assert.equal(eachEol(md, add(4, '# install')), null)
  })
})

describe('addSection', () => {
  test('goes before Inbox, so Inbox stays last', () => {
    assert.equal(
      eachEol('# Todo\n\n## This week\n\n## Inbox\n- [ ] x\n', section('Ideas')),
      '# Todo\n\n## This week\n\n## Ideas\n\n## Inbox\n- [ ] x\n',
    )
    assert.equal(eachEol('## A\n- [ ] x\n## Inbox\n', section('Ideas')), '## A\n- [ ] x\n\n## Ideas\n\n## Inbox\n')
    assert.equal(eachEol('# T\n## Inbox', section('Ideas')), '# T\n\n## Ideas\n\n## Inbox')
  })

  test('goes at the end when there is no Inbox', () => {
    assert.equal(eachEol('# Todo\n\n## A\n- [ ] x\n', section('Ideas')), '# Todo\n\n## A\n- [ ] x\n\n## Ideas\n')
    assert.equal(eachEol('# Todo\n\n\n', section('Ideas')), '# Todo\n\n## Ideas\n')
    assert.equal(eachEol('# Todo\n- [ ] x', section('Ideas')), '# Todo\n- [ ] x\n\n## Ideas\n')
  })

  test('an empty file gets just the heading', () => {
    assert.equal(addSection('', 'Ideas'), '## Ideas\n')
    assert.equal(addSection('\n\n', 'Ideas'), '## Ideas\n')
  })

  test('refuses a title that exists, whatever its case or level', () => {
    assert.equal(eachEol('# Todo\n\n## Ideas\n', section('ideas')), null)
    assert.equal(eachEol('# Ideas\n', section('Ideas')), null)
  })

  test('headings inside a fenced code block do not count', () => {
    const md = '# Todo\n\n```md\n## Inbox\n## Ideas\n```\n'
    assert.equal(eachEol(md, section('Ideas')), '# Todo\n\n```md\n## Inbox\n## Ideas\n```\n\n## Ideas\n')
  })
})

describe('deleteSection', () => {
  test('removes the heading and everything under it', () => {
    assert.equal(eachEol('# T\n\n## A\n- [ ] x\n\n## B\n- [ ] y\n', remove(3, '## A')), '# T\n\n## B\n- [ ] y\n')
  })

  test('takes ### sub-sections along and stops at the next same-or-higher heading', () => {
    const md = '## A\nx\n\n### A1\ny\n\n## B\nz\n'
    assert.equal(eachEol(md, remove(1, '## A')), '## B\nz\n')
    assert.equal(eachEol(md, remove(4, '### A1')), '## A\nx\n\n## B\nz\n')
    assert.equal(eachEol('## A\n### A1\ny\n# Top\nz\n', remove(2, '### A1')), '## A\n# Top\nz\n')
  })

  test('the last section leaves the file ending as it did', () => {
    assert.equal(eachEol('## A\nx\n## B\ny\n', remove(3, '## B')), '## A\nx\n')
    assert.equal(eachEol('## A\nx\n\n## B\ny\n\n\n', remove(4, '## B')), '## A\nx\n')
    assert.equal(eachEol('## A\nx\n\n## B\ny', remove(4, '## B')), '## A\nx')
  })

  test('finds a heading that moved; refuses an ambiguous one', () => {
    assert.equal(eachEol('# T\n\n## A\nx\n', remove(1, '## A')), '# T\n')
    const md = '## Notes\na\n## Notes\nb\n'
    assert.equal(eachEol(md, remove(2, '## Notes')), null)
    assert.equal(eachEol(md, remove(3, '## Notes')), '## Notes\na\n')
  })

  test('a "# comment" in a fenced code block is neither a boundary nor a section', () => {
    const md = '## Setup\n```sh\n# install\n```\n\n## Next\nz\n'
    assert.equal(eachEol(md, remove(1, '## Setup')), '## Next\nz\n')
    assert.equal(eachEol(md, remove(3, '# install')), null)
  })
})

describe('renameHeading', () => {
  test('renames an ATX heading, keeping its level', () => {
    assert.equal(eachEol('# T\n\n### Old ###\nx\n', rename(3, '### Old ###')), '# T\n\n### New\nx\n')
  })

  test('turns a setext heading into ATX of the same level', () => {
    assert.equal(eachEol('Old\n===\nx\n', rename(1, 'Old')), '# New\nx\n')
    assert.equal(eachEol('Old\n---\nx\n', rename(1, 'Old')), '## New\nx\n')
    assert.equal(eachEol('Two line\nheading\n---\nx\n', rename(1, 'Two line')), '## New\nx\n')
    assert.equal(eachEol('x\n\nOld\n---', rename(3, 'Old')), 'x\n\n## New')
  })

  test('finds a heading that moved; refuses an ambiguous or missing one', () => {
    assert.equal(eachEol('# T\nadded\n## A\n', rename(2, '## A')), '# T\nadded\n## New\n')
    const md = '## Notes\n\n## Notes\n'
    assert.equal(eachEol(md, rename(2, '## Notes')), null)
    assert.equal(eachEol(md, rename(3, '## Notes')), '## Notes\n\n## New\n')
    assert.equal(eachEol(md, rename(1, '## Gone')), null)
  })

  test('a "# comment" in a fenced code block is not a heading', () => {
    // The page addresses the real heading; the comment is no rival and stays.
    const md = '```sh\n# install\n```\n# install\n'
    assert.equal(eachEol(md, rename(2, '# install')), '```sh\n# install\n```\n# New\n')
  })
})
