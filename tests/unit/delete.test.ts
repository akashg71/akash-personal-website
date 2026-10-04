import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { deleteTask } from '@/lib/notes'
import { eachEol } from './helpers'

// deleteTask the way the delete route calls it: 1-based line + raw line.
const remove = (line: number, raw: string) => (c: string, cr: string) => deleteTask(c, line, raw + cr)

describe('deleteTask', () => {
  test('removes the item with everything nested under it', () => {
    const md = '- [ ] a\n  more about a\n  - [ ] a1\n    - [x] a2\n- [ ] b\n'
    assert.equal(eachEol(md, remove(1, '- [ ] a')), '- [ ] b\n')
    assert.equal(eachEol(md, remove(3, '  - [ ] a1')), '- [ ] a\n  more about a\n- [ ] b\n')
    assert.equal(eachEol(md, remove(5, '- [ ] b')), '- [ ] a\n  more about a\n  - [ ] a1\n    - [x] a2\n')
  })

  test('tidies the seam so no blank-line pile-up is left', () => {
    assert.equal(eachEol('x\n\n- [ ] a\n\ny\n', remove(3, '- [ ] a')), 'x\n\ny\n')
    assert.equal(eachEol('- [ ] a\n\n- [ ] b\n\n- [ ] c\n', remove(3, '- [ ] b')), '- [ ] a\n\n- [ ] c\n')
  })

  test('keeps a single trailing newline, or none if the file had none', () => {
    assert.equal(eachEol('# T\n\n- [ ] a\n', remove(3, '- [ ] a')), '# T\n')
    assert.equal(eachEol('- [ ] a\n- [ ] b\n\n\n', remove(2, '- [ ] b')), '- [ ] a\n')
    assert.equal(eachEol('# T\n- [ ] a', remove(2, '- [ ] a')), '# T')
    assert.equal(eachEol('# T\n\n- [ ] a', remove(3, '- [ ] a')), '# T')
  })

  test('deletes tasks in blockquotes and ordered lists', () => {
    assert.equal(eachEol('> - [ ] a\n> - [ ] b\n', remove(1, '> - [ ] a')), '> - [ ] b\n')
    assert.equal(eachEol('1. [ ] a\n2. [X] b\n', remove(2, '2. [X] b')), '1. [ ] a\n')
  })

  test('matches the line whatever state the page saw it in', () => {
    assert.equal(eachEol('- [x] a\n- [ ] b\n', remove(1, '- [ ] a')), '- [ ] b\n')
  })

  test('finds a task that moved, by its unique text', () => {
    // The page saw "- [ ] b" on line 2; a line was added above it since.
    assert.equal(eachEol('- [ ] new\n- [ ] a\n- [ ] b\n', remove(2, '- [ ] b')), '- [ ] new\n- [ ] a\n')
  })

  test('refuses when the line moved and its text is not unique', () => {
    const md = '- [ ] new\n- [ ] dup\n- [x] dup\n'
    assert.equal(eachEol(md, remove(1, '- [ ] dup')), null)
    assert.equal(eachEol(md, remove(3, '- [x] dup')), '- [ ] new\n- [ ] dup\n')
  })

  test('refuses plain list items and tasks that are gone', () => {
    assert.equal(eachEol('- a\n- [ ] b\n', remove(1, '- a')), null)
    assert.equal(eachEol('- [ ] a\n', remove(1, '- [ ] gone')), null)
  })

  test('a code block nested in the task goes with it, "# comment" and all', () => {
    const md = '- [ ] deploy\n  ```sh\n  # comment\n  make deploy\n  ```\n- [ ] next\n'
    assert.equal(eachEol(md, remove(1, '- [ ] deploy')), '- [ ] next\n')
  })

  test('never deletes a task-like line inside a fenced code block', () => {
    const md = '```md\n# comment\n- [ ] a\n```\n\n- [ ] a\n'
    assert.equal(eachEol('```md\n# comment\n- [ ] a\n```\n', remove(3, '- [ ] a')), null)
    // The real task was on line 7 before a line above it went; the copy in the code is no rival.
    assert.equal(eachEol(md, remove(7, '- [ ] a')), '```md\n# comment\n- [ ] a\n```\n')
  })
})
