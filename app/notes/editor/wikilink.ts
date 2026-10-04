// [[Wiki links]] and ![[embeds]] in the rich editor. Without this, remark
// reads them as text and a save escapes them: [[Note]] became \[\[Note]] and
// [[a_b]] became \[\[a\_b]], a different note in Obsidian. Each link is an
// inline atom holding the raw text between the brackets, written back as is;
// an escaped \[\[x]] is plain text and stays escaped.
import { remarkStringifyOptionsCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { InputRule } from '@milkdown/kit/prose/inputrules'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { $inputRule, $nodeSchema, $prose, $remark } from '@milkdown/kit/utils'
import type { Handle } from 'mdast-util-to-markdown'
import { isWikiValue, remarkWikiLink, wikiLabel } from '@/lib/wikilink'

const literal = (value: string, embed: boolean) => `${embed ? '!' : ''}[[${value}]]`

const wikiLinkRemark = $remark('wikiLink', () => remarkWikiLink)

export const wikiLinkSchema = $nodeSchema('wikiLink', () => ({
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  attrs: {
    value: { default: '', validate: 'string' },
    embed: { default: false, validate: 'boolean' },
  },
  leafText: node => literal(node.attrs.value, node.attrs.embed), // copied as text
  parseDOM: [
    {
      tag: 'span[data-wikilink]',
      getAttrs: dom => ({ value: dom.getAttribute('data-value') ?? '', embed: dom.hasAttribute('data-embed') }),
    },
  ],
  toDOM: node => [
    'span',
    {
      'data-wikilink': '',
      'data-value': node.attrs.value,
      ...(node.attrs.embed ? { 'data-embed': '' } : {}),
      class: 'wikilink',
      title: literal(node.attrs.value, node.attrs.embed),
    },
    wikiLabel(node.attrs.value, node.attrs.embed),
  ],
  parseMarkdown: {
    match: node => node.type === 'wikiLink',
    runner: (state, node, type) => {
      state.addNode(type, { value: node.value as string, embed: node.embed === true })
    },
  },
  toMarkdown: {
    match: node => node.type.name === 'wikiLink',
    runner: (state, node) => {
      state.addNode('wikiLink', undefined, node.attrs.value, { embed: node.attrs.embed })
    },
  },
}))

// Typing the closing "]]" makes the link. Milkdown skips input rules in code
// blocks but not in inline code, where [[x]] has to stay text. \ufffc stands
// for another inline node (an image, a link), which must not be swallowed.
const wikiLinkInputRule = $inputRule(ctx =>
  new InputRule(/(!?)\[\[([^[\]\n`\ufffc]+)\]\]$/, (state, match, start, end) => {
    if (!isWikiValue(match[2])) return null
    let code = false
    state.doc.nodesBetween(start, end, node => {
      code ||= node.marks.some(mark => mark.type.spec.code)
    })
    if (code) return null
    return state.tr.replaceWith(start, end, wikiLinkSchema.type(ctx).create({ value: match[2], embed: match[1] === '!' }))
  }),
)

// Inline code over a link (the code button, or a closing backtick) would make
// a code span with the atom inside, which saves as an empty ``. Turn such a
// link back into its text, so `[[x]]` saves as written.
const wikiLinkCodeGuard = $prose(ctx => new Plugin({
  key: new PluginKey('wikiLinkCodeGuard'),
  appendTransaction: (transactions, _old, state) => {
    if (!transactions.some(tr => tr.docChanged)) return null
    const type = wikiLinkSchema.type(ctx)
    const coded: { pos: number; text: string; size: number; marks: typeof state.doc.marks }[] = []
    state.doc.descendants((node, pos) => {
      if (node.type === type && node.marks.some(mark => mark.type.spec.code)) {
        coded.push({ pos, text: literal(node.attrs.value, node.attrs.embed), size: node.nodeSize, marks: node.marks })
      }
    })
    if (!coded.length) return null
    const tr = state.tr
    for (const { pos, text, size, marks } of coded.reverse()) tr.replaceWith(pos, pos + size, state.schema.text(text, marks))
    return tr
  },
}))

export const wikiLink = [wikiLinkRemark, wikiLinkSchema, wikiLinkInputRule, wikiLinkCodeGuard].flat()

// Milkdown writes a text that ends in a space as it is, without escapes, so an
// escaped \[\[x]] followed by, say, `code` came back as a link. Escape its
// brackets as the usual path would.
export function keepLiteralBrackets(ctx: Ctx) {
  ctx.update(remarkStringifyOptionsCtx, prev => {
    const text: Handle | undefined = prev.handlers?.text
    if (!text) return prev
    const escaped: Handle = (node, parent, state, info) => {
      const out = text(node, parent, state, info)
      return out === node.value && out.includes('[[') ? out.replaceAll('[', '\\[') : out
    }
    return { ...prev, handlers: { ...prev.handlers, text: escaped } }
  })
}
