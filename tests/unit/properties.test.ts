import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { parseProperties, readableDate, tagsOf } from '@/lib/notes/properties'

const list = (yaml: string) => {
  const props = parseProperties(yaml)
  assert.equal(props.error, null)
  return props.list
}
const error = (yaml: string) => parseProperties(yaml).error

describe('parseProperties', () => {
  test('reads strings, numbers, booleans and empty values; dates stay strings', () => {
    assert.deepEqual(list('title: Hello\ncount: 3\nratio: -0.5\ndraft: false\ndate: 2026-10-04\nnothing:\n'), [
      { key: 'title', value: 'Hello' },
      { key: 'count', value: 3 },
      { key: 'ratio', value: -0.5 },
      { key: 'draft', value: false },
      { key: 'date', value: '2026-10-04' },
      { key: 'nothing', value: null },
    ])
  })

  test('reads lists, and an unquoted [[link]] as written', () => {
    assert.deepEqual(list('tags: [a, b]\naliases:\n  - One\n  - 2\nup: [[Home]]\nrelated:\n  - [[A]]\n  - "[[B|b]]"\n'), [
      { key: 'tags', value: ['a', 'b'] },
      { key: 'aliases', value: ['One', 2] },
      { key: 'up', value: '[[Home]]' },
      { key: 'related', value: ['[[A]]', '[[B|b]]'] },
    ])
  })

  test('keeps maps, nested lists and templates as their own YAML', () => {
    assert.deepEqual(list('author:\n  name: A\n  links: [x, y]\nrows:\n  - [1, 2]\ncreated: {{date}}\n'), [
      { key: 'author', value: { yaml: 'name: A\nlinks: [x, y]' } },
      { key: 'rows', value: { yaml: '- [1, 2]' } },
      { key: 'created', value: { yaml: '{{date}}' } },
    ])
  })

  test('keeps the YAML key order and never touches a prototype', () => {
    const props = list('b: 1\n2: two\n__proto__: {polluted: yes}\nconstructor: x\n1: one')
    assert.deepEqual(props.map(p => p.key), ['b', '2', '__proto__', 'constructor', '1'])
    assert.equal(({} as Record<string, unknown>).polluted, undefined)
  })

  test('reads CRLF and lone CR line endings', () => {
    assert.deepEqual(list('a: 1\r\nnote: |\r\n  one\r\n  two\r\n'), [{ key: 'a', value: 1 }, { key: 'note', value: 'one\ntwo\n' }])
    assert.deepEqual(list('a: 1\rb: 2'), [{ key: 'a', value: 1 }, { key: 'b', value: 2 }])
  })

  test('explicit YAML 1.1 tags read as text', () => {
    assert.deepEqual(list('t: !!timestamp 2026-10-04\nb: !!binary aGk=\nc: !custom x'), [
      { key: 't', value: '2026-10-04' },
      { key: 'b', value: { yaml: 'aGk=' } },
      { key: 'c', value: 'x' },
    ])
  })

  test('no properties for empty YAML or only comments', () => {
    assert.deepEqual(list(''), [])
    assert.deepEqual(list('# just a comment'), [])
  })

  test('reports invalid YAML with its line in the file', () => {
    assert.equal(error('a: 1\nb: 2\na: 3'), 'Map keys must be unique (line 4)')
    assert.equal(error('title: Re: x'), 'Nested mappings are not allowed in compact mappings (line 2)')
    assert.equal(error('tags:\n\t- a'), 'Tabs are not allowed as indentation (line 3)')
    assert.match(error('tags: [a, b') ?? '', /^Flow sequence .* \(line 2\)$/)
  })

  test('refuses YAML that is not key: value lines', () => {
    assert.equal(error('Intro'), 'Properties must be “key: value” lines')
    assert.equal(error('- a\n- b'), 'Properties must be “key: value” lines')
  })

  test('refuses an alias bomb and an alias with no anchor', () => {
    const level = (name: string, prev: string) => `${name}: &${name} [${Array(10).fill(`*${prev}`).join(', ')}]`
    const bomb = ['a: &a [x, x, x, x, x, x, x, x, x, x]', level('b', 'a'), level('c', 'b'), level('d', 'c'), level('e', 'd')].join('\n')
    assert.match(error(bomb) ?? '', /resource exhaustion/)
    assert.match(error('a: *nope') ?? '', /^Unresolved alias/)
    assert.deepEqual(list('a: &x hi\nb: *x'), [{ key: 'a', value: 'hi' }, { key: 'b', value: 'hi' }])
  })

  test('never writes YAML warnings to the server log', t => {
    const warn = t.mock.method(process, 'emitWarning', () => {})
    const log = t.mock.method(console, 'warn', () => {})
    list('created: {{date}}\nc: !custom x')
    assert.equal(warn.mock.callCount() + log.mock.callCount(), 0)
  })
})

describe('tagsOf', () => {
  test('reads a list or a comma or space separated string, dropping any #', () => {
    assert.deepEqual(tagsOf({ key: 'tags', value: ['work', '#idea', null, 2026] }), ['work', 'idea', '2026'])
    assert.deepEqual(tagsOf({ key: 'Tags', value: '#a, b c' }), ['a', 'b', 'c'])
    assert.deepEqual(tagsOf({ key: 'tag', value: null }), [])
  })

  test('is null for other keys and for values that are not tags', () => {
    assert.equal(tagsOf({ key: 'title', value: 'x' }), null)
    assert.equal(tagsOf({ key: 'tags', value: 3 }), null)
    assert.equal(tagsOf({ key: 'tags', value: { yaml: 'a: 1' } }), null)
  })
})

describe('readableDate', () => {
  test('formats a date, and keeps a time as written', () => {
    assert.equal(readableDate('2026-10-04'), '4 Oct 2026')
    assert.equal(readableDate('2026-01-31T09:30'), '31 Jan 2026, 09:30')
    assert.equal(readableDate('2026-10-04 23:05:59+01:00'), '4 Oct 2026, 23:05')
  })

  test('is null for anything that is not a real date', () => {
    for (const s of ['2026-02-30', '2026-13-01', '2026-10-4', '2026-10-04 meeting', 'soon', '20261004']) {
      assert.equal(readableDate(s), null, s)
    }
  })
})
