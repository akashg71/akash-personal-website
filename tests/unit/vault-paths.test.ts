import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { isFolderPath, isNotePath, lastReviewed, renameTask, stampReview, taskSource, taskText, toNotePath } from '@/lib/notes'
import { encodePath, ISO_DATE_RE, journalPath, noteHref, noteName } from '@/lib/paths'
import { eachEol } from './helpers'

describe('note and folder paths', () => {
  test('toNotePath trims each segment and adds .md', () => {
    assert.equal(toNotePath('Physics/ Mechanics '), 'Physics/Mechanics.md')
    assert.equal(toNotePath(' a // b '), 'a/b.md')
    assert.equal(toNotePath('Notes.MD'), 'Notes.MD')
  })

  test('toNotePath refuses what can never be a note', () => {
    const bad = ['', '  ', '/', '../secret', 'a/../b', '.hidden', 'a/.obsidian/x', 'tab\there', 'q?', 'a\\b', 'x'.repeat(198)]
    for (const name of bad) assert.equal(toNotePath(name), null, name)
  })

  test('isNotePath takes .md files in any folder, any case', () => {
    const ok = ['todo.md', 'a.md', 'Physics/Mechanics.md', 'Notes.MD', "Q&A (v2), draft + more!.md", `${'x'.repeat(197)}.md`]
    for (const p of ok) assert.equal(isNotePath(p), true, p)
  })

  test('isNotePath refuses dot segments, odd whitespace and long paths', () => {
    const bad = ['.md', 'todo', 'todo.txt', 'todo.md ', '/todo.md', 'todo.md/', '.hidden.md', 'a/.git/x.md', '../x.md',
      'a/../x.md', './x.md', 'a//x.md', ' x.md', 'a /x.md', 'a\tb.md', 'a\nb.md', `${'x'.repeat(198)}.md`]
    for (const p of bad) assert.equal(isNotePath(p), false, JSON.stringify(p))
    for (const p of [undefined, null, 42, ['a.md']]) assert.equal(isNotePath(p), false)
  })

  test('letters from any script are fine, combining marks included', () => {
    const ok = ['Café.md', 'Cafe\u0301.md', '日本語/メモ.md', 'Ελληνικά.md', 'हिन्दी नोट्स.md']
    for (const p of ok) assert.equal(isNotePath(p), true, p)
    assert.equal(isNotePath('emoji 📝.md'), false)
  })

  test('isFolderPath', () => {
    for (const p of ['Physics', 'Physics/Classical', 'Cafe\u0301', 'x'.repeat(200)]) assert.equal(isFolderPath(p), true, p)
    const bad = ['', '.', '..', '../x', 'a/..', 'a/./b', '.obsidian', 'a/', '/a', ' a', 'a ', 'a\tb', 'x'.repeat(201), 42]
    for (const p of bad) assert.equal(isFolderPath(p), false, JSON.stringify(p))
  })
})

describe('URL helpers', () => {
  test('encodePath encodes each segment and keeps the slashes', () => {
    assert.equal(encodePath('Physics/Classical Mechanics.md'), 'Physics/Classical%20Mechanics.md')
    assert.equal(encodePath('Q&A/a+b #1?.md'), 'Q%26A/a%2Bb%20%231%3F.md')
    assert.equal(encodePath('Café/日本.md'), 'Caf%C3%A9/%E6%97%A5%E6%9C%AC.md')
    assert.equal(noteHref('My Notes/todo.md'), '/notes/My%20Notes/todo.md')
  })

  test('noteName drops the folder and .md, any case', () => {
    assert.equal(noteName('Physics/Mechanics.md'), 'Mechanics')
    assert.equal(noteName('Notes.MD'), 'Notes')
    assert.equal(noteName('v1.2 notes.md'), 'v1.2 notes')
  })

  test('journalPath files a day under Journal/', () => {
    assert.equal(journalPath('2026-10-04'), 'Journal/2026-10-04.md')
    assert.match('2026-10-04', ISO_DATE_RE)
    assert.doesNotMatch('2026-10-4', ISO_DATE_RE)
  })
})

describe('taskText and taskSource', () => {
  test('taskText is the plain text, for commit messages', () => {
    assert.equal(taskText('- [ ] Write **phase 5** post — see [plan](https://x.y/z)'), 'Write phase 5 post — see plan')
    assert.equal(taskText('  > 2. [x] `npm test` ~~soon~~ __now__\r'), 'npm test soon now')
  })

  test('taskSource is the markdown after the checkbox', () => {
    assert.equal(taskSource('  - [x] **bold** [link](https://x.y)\r'), '**bold** [link](https://x.y)')
    assert.equal(taskSource('> 1) [ ] quoted'), 'quoted')
  })
})

describe('renameTask', () => {
  const rename = (line: number, raw: string) => (c: string, cr: string) => renameTask(c, line, raw + cr, 'new text')
  const md = '- [ ] a\n  * [x] b\n\n> + [X] c\n\n3) [ ] d\n'

  test('replaces the text, keeping indent, bullet and state', () => {
    assert.equal(eachEol(md, rename(1, '- [ ] a')), md.replace('] a', '] new text'))
    assert.equal(eachEol(md, rename(2, '  * [x] b')), md.replace('] b', '] new text'))
    assert.equal(eachEol(md, rename(4, '> + [X] c')), md.replace('] c', '] new text'))
    assert.equal(eachEol(md, rename(6, '3) [ ] d')), md.replace('] d', '] new text'))
    assert.equal(eachEol('# T\n- [ ] a', rename(2, '- [ ] a')), '# T\n- [ ] new text')
  })

  test('finds a task that moved; refuses an ambiguous or missing one', () => {
    assert.equal(eachEol('- [ ] new\n- [ ] a\n', rename(1, '- [ ] a')), '- [ ] new\n- [ ] new text\n')
    const dup = '- [ ] new\n- [ ] dup\n- [x] dup\n'
    assert.equal(eachEol(dup, rename(1, '- [ ] dup')), null)
    assert.equal(eachEol(dup, rename(3, '- [x] dup')), '- [ ] new\n- [ ] dup\n- [x] new text\n')
    assert.equal(eachEol(dup, rename(1, '- [ ] gone')), null)
  })

  test('never renames a task-like line inside a fenced code block', () => {
    const code = '```md\n# comment\n- [ ] a\n```\n'
    assert.equal(eachEol(code, rename(3, '- [ ] a')), null)
    assert.equal(eachEol(`${code}- [ ] a\n`, rename(1, '- [ ] a')), `${code}- [ ] new text\n`)
  })
})

describe('review stamp', () => {
  const stamp = (c: string) => stampReview(c, '2026-10-04')

  test('lastReviewed reads the stamp line', () => {
    assert.equal(lastReviewed('# Todo\n\nLast reviewed: 2026-09-27\n'), '2026-09-27')
    assert.equal(lastReviewed('# Todo\r\n\r\nlast reviewed:2026-09-27  \r\n'), '2026-09-27')
    assert.equal(lastReviewed('# Todo\n\nLast reviewed: soon\n'), null)
    assert.equal(lastReviewed(''), null)
  })

  test('stampReview replaces the stamp, or is null when already stamped that day', () => {
    assert.equal(eachEol('# Todo\n\nLast reviewed: 2026-09-27\n\n## A\n', stamp), '# Todo\n\nLast reviewed: 2026-10-04\n\n## A\n')
    assert.equal(eachEol('# Todo\n\nLast reviewed: 2026-09-27', stamp), '# Todo\n\nLast reviewed: 2026-10-04')
    assert.equal(eachEol('# Todo\n\nLast reviewed: 2026-10-04\n', stamp), null)
  })

  test('stampReview adds the stamp under the H1', () => {
    assert.equal(eachEol('# Todo\n\n## A\n', stamp), '# Todo\n\nLast reviewed: 2026-10-04\n\n## A\n')
    assert.equal(eachEol('# Todo\n## A\n', stamp), '# Todo\n\nLast reviewed: 2026-10-04\n\n## A\n')
    assert.equal(eachEol('Todo\n====\n\n## A\n', stamp), 'Todo\n====\n\nLast reviewed: 2026-10-04\n\n## A\n')
    assert.equal(eachEol('intro\n# Todo', stamp), 'intro\n# Todo\n\nLast reviewed: 2026-10-04')
  })

  test('stampReview puts the stamp first when there is no H1', () => {
    assert.equal(eachEol('## A\n- [ ] x\n', stamp), 'Last reviewed: 2026-10-04\n\n## A\n- [ ] x\n')
    assert.equal(stamp(''), 'Last reviewed: 2026-10-04\n\n')
  })

  test('a "# comment" in a fenced code block is not the H1', () => {
    const md = '## A\n\n```sh\n# comment\n```\n'
    assert.equal(eachEol(md, stamp), `Last reviewed: 2026-10-04\n\n${md}`)
  })
})
