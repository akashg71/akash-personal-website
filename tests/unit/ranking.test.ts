import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { rankNotes } from '@/lib/paths'

describe('rankNotes', () => {
  test('exact name > prefix > substring > path > subsequence', () => {
    const vault = ['Zebra.md', 'Mathematics/Echo.md', 'Mech Notes/Overview.md', 'Classical Mechanics.md', 'Mechanics.md', 'Mech.md']
    assert.deepEqual(rankNotes(vault, 'mech'), [
      'Mech.md', // exact name
      'Mechanics.md', // name prefix
      'Classical Mechanics.md', // name substring
      'Mech Notes/Overview.md', // path substring
      'Mathematics/Echo.md', // m-e-c-h in order
    ])
  })

  test('every word somewhere in the path beats a bare subsequence', () => {
    assert.deepEqual(rankNotes(['Calm Echo.md', 'Classical Mechanics.md'], 'cl mech'), ['Classical Mechanics.md', 'Calm Echo.md'])
  })

  test('is case-insensitive and ignores surrounding whitespace, a pasted CRLF included', () => {
    assert.deepEqual(rankNotes(['todo.md', 'Todo list.md'], '  TODO\r\n'), ['todo.md', 'Todo list.md'])
  })

  test('the .md extension never matches', () => {
    assert.deepEqual(rankNotes(['Physics/Mechanics.md', 'Zebra.md'], 'md'), [])
  })

  test('same name in several folders: all kept, shorter path first, then alphabetical', () => {
    assert.deepEqual(rankNotes(['Work/todo.md', 'todo.md', 'Home/todo.md'], 'todo'), ['todo.md', 'Home/todo.md', 'Work/todo.md'])
  })

  test('an empty query lists everything in natural order', () => {
    // Same-case names: the order of 'a' and 'N' depends on the machine's locale.
    const vault = ['Note 10.md', 'Note 2.md', 'Alpha.md', 'Note 1.md']
    assert.deepEqual(rankNotes(vault, ''), ['Alpha.md', 'Note 1.md', 'Note 2.md', 'Note 10.md'])
    assert.deepEqual(rankNotes(vault, '   '), ['Alpha.md', 'Note 1.md', 'Note 2.md', 'Note 10.md'])
  })

  test('returns at most `limit` results, 50 by default', () => {
    const vault = Array.from({ length: 60 }, (_, i) => `Note ${i}.md`)
    assert.equal(rankNotes(vault, '').length, 50)
    assert.equal(rankNotes(vault, 'note').length, 50)
    assert.deepEqual(rankNotes(vault, 'note', 2), ['Note 0.md', 'Note 1.md'])
  })

  test('does not reorder the caller\'s array', () => {
    const vault = ['b.md', 'a.md']
    rankNotes(vault, '')
    assert.deepEqual(vault, ['b.md', 'a.md'])
  })
})
