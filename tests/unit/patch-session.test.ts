import { afterEach, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { checkPassword, createSessionToken, isValidSession, patchTask, SESSION_MAX_AGE } from '@/lib/notes'
import { crlf, eachEol } from './helpers'

// patchTask the way the toggle route calls it; null unless it patched.
const tick = (line: number, raw: string, checked = true) => (content: string, cr: string) => {
  const r = patchTask(content, line, raw + cr, checked)
  return r.kind === 'patched' ? r.content : null
}

describe('patchTask', () => {
  test('ticks an open task and reports its plain text', () => {
    assert.deepEqual(patchTask('# Todo\n\n- [ ] Ship **it**\n', 3, '- [ ] Ship **it**', true), {
      kind: 'patched',
      content: '# Todo\n\n- [x] Ship **it**\n',
      text: 'Ship it',
    })
  })

  test('unticks a done task, uppercase [X] included', () => {
    assert.equal(eachEol('- [x] a\n- [X] b\n', tick(2, '- [X] b', false)), '- [x] a\n- [ ] b\n')
  })

  test('is a noop when the task is already in that state', () => {
    assert.equal(patchTask('- [x] a\n', 1, '- [x] a', true).kind, 'noop')
    assert.equal(patchTask('- [X] a\n', 1, '- [X] a', true).kind, 'noop')
    assert.equal(patchTask('- [ ] a\n', 1, '- [ ] a', false).kind, 'noop')
    // Ticked on another device after this page loaded.
    assert.equal(patchTask('- [x] a\n', 1, '- [ ] a', true).kind, 'noop')
  })

  test('is not-found when the task is gone or the line is not a task', () => {
    assert.equal(patchTask('- [ ] a\n', 1, '- [ ] b', true).kind, 'not-found')
    assert.equal(patchTask('- a\n', 1, '- a', true).kind, 'not-found')
    assert.equal(patchTask('', 1, '- [ ] a', true).kind, 'not-found')
  })

  test('ticks tasks in blockquotes, ordered lists and nested lists', () => {
    assert.equal(eachEol('> - [ ] quoted\n', tick(1, '> - [ ] quoted')), '> - [x] quoted\n')
    assert.equal(eachEol('> > * [ ] deeper\n', tick(1, '> > * [ ] deeper')), '> > * [x] deeper\n')
    assert.equal(eachEol('1. [ ] one\n2. [ ] two\n', tick(2, '2. [ ] two')), '1. [ ] one\n2. [x] two\n')
    assert.equal(eachEol('3) [ ] paren\n', tick(1, '3) [ ] paren')), '3) [x] paren\n')
    assert.equal(eachEol('- [ ] a\n  + [ ] nested\n', tick(2, '  + [ ] nested')), '- [ ] a\n  + [x] nested\n')
  })

  test('keeps CRLF on every line, with or without a trailing newline', () => {
    const r = patchTask(crlf('# Todo\n\n- [ ] a\n- [ ] b\n'), 4, '- [ ] b\r', true)
    assert.equal(r.kind === 'patched' && r.content, crlf('# Todo\n\n- [ ] a\n- [x] b\n'))
    assert.equal(eachEol('- [ ] a\n- [ ] b', tick(2, '- [ ] b')), '- [ ] a\n- [x] b')
  })

  test('finds a task that moved, by its unique text', () => {
    // The page saw "- [ ] b" on line 2; a line was added above it since.
    assert.equal(eachEol('- [ ] new\n- [ ] a\n- [ ] b\n', tick(2, '- [ ] b')), '- [ ] new\n- [ ] a\n- [x] b\n')
  })

  test('refuses when the line moved and its text is not unique', () => {
    const md = '- [ ] new\n- [ ] dup\n- [x] dup\n'
    assert.equal(eachEol(md, tick(1, '- [ ] dup')), null)
    // The line number still picks between duplicates while it is right.
    assert.equal(eachEol(md, tick(2, '- [ ] dup')), '- [ ] new\n- [x] dup\n- [x] dup\n')
  })

  test('never ticks a task-like line inside a fenced code block', () => {
    const code = '```md\n# comment\n- [ ] deploy\n```\n'
    assert.equal(eachEol(code, tick(3, '- [ ] deploy')), null)
    // The real task moved below the block; the copy in the code is no rival.
    assert.equal(eachEol(`${code}\n- [ ] deploy\n`, tick(1, '- [ ] deploy')), `${code}\n- [x] deploy\n`)
  })

  test('in a dense note, each tick flips one checkbox and nothing else', () => {
    const LOOKALIKE = /code block|table|indented code|html/
    const dense = [
      '# Todo', '', 'Last reviewed: 2026-09-27', '', 'Setext title', '============', '',
      '## This week',
      '- [ ] Write **phase 5** post — see [plan](https://example.com)',
      '  - [x] outline',
      '    1. [ ] nested ordered',
      '- [X] Ship it', '',
      '> - [ ] quoted task', '> > * [x] deeper', '',
      '```md', '# comment', '- [ ] in a code block', '```', '',
      '| task | n |', '|---|---|', '| - [ ] in a table | 2 |', '',
      '    - [ ] indented code', '',
      '<div>', '- [ ] inside html', '</div>', '',
      '## Inbox', '+ [ ] last', '',
    ].join('\n')
    for (const md of [dense, crlf(dense)]) {
      const lines = md.split('\n')
      let ticked = 0
      for (const [i, l] of lines.entries()) {
        if (!/\[[ xX]\]/.test(l)) continue
        const open = l.includes('[ ]')
        const r = patchTask(md, i + 1, l, open)
        if (LOOKALIKE.test(l)) {
          assert.equal(r.kind, 'not-found', l)
          continue
        }
        assert.equal(r.kind === 'patched' && r.content, lines.with(i, l.replace(/\[[ xX]\]/, open ? '[x]' : '[ ]')).join('\n'))
        ticked++
      }
      assert.equal(ticked, 7)
    }
  })
})

describe('sessions', () => {
  const saved = process.env.NOTES_PASSWORD
  beforeEach(() => {
    process.env.NOTES_PASSWORD = 'correct horse battery staple'
  })
  afterEach(() => {
    if (saved === undefined) delete process.env.NOTES_PASSWORD
    else process.env.NOTES_PASSWORD = saved
  })

  test('a fresh token is valid', () => {
    const token = createSessionToken()
    assert.match(token, /^\d+\.[\w-]+$/)
    assert.equal(isValidSession(token), true)
  })

  test('a token expires SESSION_MAX_AGE seconds after login', t => {
    t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 })
    const token = createSessionToken()
    t.mock.timers.setTime(1_000_000 + SESSION_MAX_AGE * 1000)
    assert.equal(isValidSession(token), true)
    t.mock.timers.setTime(1_000_000 + SESSION_MAX_AGE * 1000 + 1)
    assert.equal(isValidSession(token), false)
  })

  test('a tampered or malformed token is rejected', () => {
    const [exp, sig] = createSessionToken().split('.')
    const forged = `${sig[0] === 'A' ? 'B' : 'A'}${sig.slice(1)}`
    assert.equal(isValidSession(`${exp}.${forged}`), false)
    assert.equal(isValidSession(`${Number(exp) + 86_400_000}.${sig}`), false) // extended expiry
    for (const bad of [undefined, '', '.', exp, `.${sig}`, 'garbage']) assert.equal(isValidSession(bad), false)
  })

  test('changing the password signs every device out', () => {
    const token = createSessionToken()
    process.env.NOTES_PASSWORD = 'a brand new password'
    assert.equal(isValidSession(token), false)
    assert.equal(isValidSession(createSessionToken()), true)
  })

  test('nothing is valid while NOTES_PASSWORD is missing', () => {
    const token = createSessionToken()
    delete process.env.NOTES_PASSWORD
    assert.equal(isValidSession(token), false)
    assert.equal(isValidSession(createSessionToken()), false)
    assert.equal(checkPassword(''), false)
  })

  test('checkPassword wants the exact password', () => {
    assert.equal(checkPassword('correct horse battery staple'), true)
    assert.equal(checkPassword('correct horse'), false)
    assert.equal(checkPassword('correct horse battery staple '), false)
    assert.equal(checkPassword(''), false)
  })
})
