import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addKey, isShown, renameKey, sectionsKey } from '../../lib/optimistic'

test('a change shows while its write is saving, whatever the page renders', () => {
  assert.equal(isShown({}, 0, 0), true)
  assert.equal(isShown({}, 9, 9), true)
})

test('hidden once the page renders the sha the write produced', () => {
  assert.equal(isShown({ seq: 3, needGen: 2 }, 3, 1), false)
})

test('hidden when a later write of ours is rendered, since it was applied on top', () => {
  assert.equal(isShown({ seq: 3, needGen: 2 }, 4, 1), false)
})

test('kept while the page still renders an earlier version', () => {
  // e.g. a refresh that started before this write finished lands first
  assert.equal(isShown({ seq: 3, needGen: 2 }, 2, 1), true)
  assert.equal(isShown({ seq: 3, needGen: 2 }, 0, 1), true)
})

test('hidden once a refresh started after the write has landed, even on an unknown sha', () => {
  // another device committed on top, so the rendered sha is not one of ours
  assert.equal(isShown({ seq: 3, needGen: 2 }, 0, 2), false)
  assert.equal(isShown({ seq: Infinity, needGen: 2 }, 0, 1), true) // no sha in the answer: wait for the refresh
  assert.equal(isShown({ seq: Infinity, needGen: 2 }, 0, 2), false)
})

test('keys separate files, sections, occurrences and kinds', () => {
  const keys = [
    addKey('todo.md', '## Inbox', 1),
    addKey('todo.md', '## Inbox', 2),
    addKey('todo.md', '## Today', 1),
    addKey('other.md', '## Inbox', 1),
    sectionsKey('todo.md'),
    sectionsKey('other.md'),
    renameKey('todo.md', 'task', '- [ ] a'),
    renameKey('todo.md', 'section', '- [ ] a'),
  ]
  assert.equal(new Set(keys).size, keys.length)
})
