import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import type { Nodes, WikiLink } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import { isWikiValue, parseWikiValue, wikiLabel, wikiLinkFromMarkdown, wikiLinkSyntax } from '../../lib/wikilink'

const parse = (md: string) =>
  fromMarkdown(md, { extensions: [gfm(), wikiLinkSyntax()], mdastExtensions: [gfmFromMarkdown(), wikiLinkFromMarkdown()] })

function links(md: string): WikiLink[] {
  const found: WikiLink[] = []
  const walk = (node: Nodes) => {
    if (node.type === 'wikiLink') found.push(node)
    if ('children' in node) node.children.forEach(walk)
  }
  walk(parse(md))
  return found
}
const written = (md: string) => links(md).map(l => `${l.embed ? '!' : ''}[[${l.value}]]`)

describe('wiki link syntax', () => {
  test('reads each form into its parts', () => {
    const cases: [md: string, value: string, embed: boolean, target: string, heading: string | null, alias: string | null][] = [
      ['[[Note]]', 'Note', false, 'Note', null, null],
      ['see [[Physics/Waves|waves]] now', 'Physics/Waves|waves', false, 'Physics/Waves', null, 'waves'],
      ['[[Mechanics#Energy]]', 'Mechanics#Energy', false, 'Mechanics', 'Energy', null],
      ['[[Mechanics#Energy|energy]]', 'Mechanics#Energy|energy', false, 'Mechanics', 'Energy', 'energy'],
      ['[[#Local]]', '#Local', false, '', 'Local', null],
      ['![[diagram.png|300]]', 'diagram.png|300', true, 'diagram.png', null, '300'],
      ['Wow![[Note]]', 'Note', true, 'Note', null, null], // as in Obsidian
      ['[[snake_case_note]]', 'snake_case_note', false, 'snake_case_note', null, null],
      ['[[a|]]', 'a|', false, 'a', null, ''],
    ]
    for (const [md, value, embed, target, heading, alias] of cases) {
      const [link, ...rest] = links(md)
      assert.deepEqual(rest, [], md)
      assert.deepEqual({ value: link?.value, embed: link?.embed, target: link?.target, heading: link?.heading, alias: link?.alias },
        { value, embed, target, heading, alias }, md)
    }
  })

  test('keeps link positions in the source', () => {
    const [link] = links('ab ![[x]] cd')
    assert.equal(link.position?.start.offset, 3)
    assert.equal(link.position?.end.offset, 9)
  })

  test('is not a link without a target, across lines, or around "[" or a backtick', () => {
    for (const md of ['[[]]', '[[ ]]', '[[|alias]]', '[[\\|alias]]', '[[a\nb]]', '[[a\r\nb]]', '[[a `b` c]]', '[[a [b] c]]', '[[a]b]]', '[[open']) {
      assert.deepEqual(written(md), [], JSON.stringify(md))
    }
  })

  test('code, escapes and autolinks keep their text', () => {
    for (const md of ['`[[x]]`', '``a [[b]] c``', '```\n[[x]]\n```', '    [[x]]', '\\[\\[x]]', '\\[[x]]', '<https://example.com/[[x]]>']) {
      assert.deepEqual(written(md), [], JSON.stringify(md))
    }
    assert.deepEqual(written('\\![[x]]'), ['[[x]]'], 'an escaped "!" leaves a link, not an embed')
  })

  test('wins over brackets around it and finds adjacent links', () => {
    assert.deepEqual(written('[[[a]]]'), ['[[a]]'])
    assert.deepEqual(written('[[A]][[B]]'), ['[[A]]', '[[B]]'])
    assert.deepEqual(written('[see [[Inside]]](https://example.com)'), ['[[Inside]]'])
    assert.deepEqual(written('**[[Bold]]** and ~~[[Struck]]~~'), ['[[Bold]]', '[[Struck]]'])
  })

  test('in a table, "\\|" divides target and alias without splitting the cell', () => {
    const [link] = links('| Note | Status |\n| --- | --- |\n| [[Mechanics\\|mech]] | done |\n')
    assert.equal(link.value, 'Mechanics\\|mech')
    assert.equal(link.target, 'Mechanics')
    assert.equal(link.alias, 'mech')
  })

  test('isWikiValue agrees with the parser', () => {
    let seed = 7
    const random = () => { // mulberry32
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const chars = ['a', 'b', ' ', '|', '\\', '#', '[', ']', '`', '!', '_', '\n']
    for (let i = 0; i < 2000; i++) {
      const raw = Array.from({ length: 1 + Math.floor(random() * 6) }, () => chars[Math.floor(random() * chars.length)]).join('')
      assert.equal(isWikiValue(raw), written(`[[${raw}]]`)[0] === `[[${raw}]]`, JSON.stringify(raw))
    }
  })
})

test('parseWikiValue splits target, heading and alias', () => {
  assert.deepEqual(parseWikiValue('Note'), { target: 'Note', heading: null, alias: null })
  assert.deepEqual(parseWikiValue(' Note # Part | shown '), { target: 'Note', heading: 'Part', alias: 'shown' })
  assert.deepEqual(parseWikiValue('Note\\|a'), { target: 'Note', heading: null, alias: 'a' })
  assert.deepEqual(parseWikiValue('Note|a|b'), { target: 'Note', heading: null, alias: 'a|b' })
  assert.deepEqual(parseWikiValue('#^block-1'), { target: '', heading: '^block-1', alias: null })
})

test('wikiLabel shows the alias, else what the link points at', () => {
  assert.equal(wikiLabel('Physics/Waves|waves'), 'waves')
  assert.equal(wikiLabel('Physics/Waves'), 'Physics/Waves')
  assert.equal(wikiLabel('Mechanics#Energy'), 'Mechanics › Energy')
  assert.equal(wikiLabel('#Local'), 'Local')
  assert.equal(wikiLabel('a|'), 'a')
})
