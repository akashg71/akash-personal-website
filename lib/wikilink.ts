// Obsidian wiki links: [[Note]], [[Note|alias]], [[Note#Heading]], [[#Heading]]
// and ![[embed]], as a micromark syntax plus mdast from/to-markdown handlers.
// Our own because the npm ones escape targets ([[snake\_case]]) or split table
// cells. Client-safe and dependency-free, so the rich editor and the view's
// parser can share it.
import type { Literal, WikiLink } from 'mdast'
import type { CompileContext, Extension as FromMarkdownExtension, Token } from 'mdast-util-from-markdown'
import type { Options as ToMarkdownExtension, State as Serializer } from 'mdast-util-to-markdown'
import type { Code, Construct, Effects, Extension, State } from 'micromark-util-types'

declare module 'mdast' {
  interface WikiLink extends Literal {
    type: 'wikiLink'
    /** Exactly what is between the brackets, e.g. "Note#Heading|alias". */
    value: string
    /** ![[…]] */
    embed: boolean
    target: string
    heading: string | null
    alias: string | null
  }
  interface PhrasingContentMap {
    wikiLink: WikiLink
  }
  interface RootContentMap {
    wikiLink: WikiLink
  }
}

declare module 'micromark-util-types' {
  interface TokenTypeMap {
    wikiLink: 'wikiLink'
    wikiLinkMarker: 'wikiLinkMarker'
    wikiLinkValue: 'wikiLinkValue'
  }
}

type WikiParts = { target: string; heading: string | null; alias: string | null }

const BANG = 33
const LEFT = 91 // [
const RIGHT = 93 // ]
const BACKSLASH = 92
const PIPE = 124
const BACKTICK = 96

// micromark codes: -5 CR, -4 LF, -3 CRLF; -2 tab, -1 virtual space.
const isLineEnding = (code: Code) => code !== null && code < -2
const isSpace = (code: Code) => code === 32 || code === -2 || code === -1

// "[[" or "![[", then everything up to the first "]]". Not a link: a line
// ending, "[" or a backtick inside (a code span keeps precedence, as it does
// over a link label), or no target before the first "|" ("\|" in tables).
function construct(embed: boolean): Construct {
  return { name: embed ? 'wikiEmbed' : 'wikiLink', tokenize }

  function tokenize(effects: Effects, ok: State, nok: State): State {
    let inAlias = false
    let hasTarget = false
    return start

    function start(code: Code): State | undefined {
      effects.enter('wikiLink')
      effects.enter('wikiLinkMarker')
      if (!embed) return open(code)
      effects.consume(code) // "!"
      return open
    }
    function open(code: Code): State | undefined {
      if (code !== LEFT) return nok(code)
      effects.consume(code)
      return openSecond
    }
    function openSecond(code: Code): State | undefined {
      if (code !== LEFT) return nok(code)
      effects.consume(code)
      effects.exit('wikiLinkMarker')
      effects.enter('wikiLinkValue')
      return inside
    }
    function inside(code: Code): State | undefined {
      if (code === null || isLineEnding(code) || code === LEFT || code === BACKTICK) return nok(code)
      if (code === RIGHT) {
        if (!hasTarget) return nok(code)
        effects.exit('wikiLinkValue')
        effects.enter('wikiLinkMarker')
        effects.consume(code)
        return close
      }
      if (code === PIPE) return divider(code)
      effects.consume(code)
      if (code === BACKSLASH) return escaped
      if (!inAlias && !isSpace(code)) hasTarget = true
      return inside
    }
    function escaped(code: Code): State | undefined {
      if (code === PIPE) return divider(code)
      if (!inAlias) hasTarget = true
      return inside(code)
    }
    function divider(code: Code): State | undefined {
      if (!inAlias && !hasTarget) return nok(code)
      inAlias = true
      effects.consume(code)
      return inside
    }
    function close(code: Code): State | undefined {
      if (code !== RIGHT) return nok(code)
      effects.consume(code)
      effects.exit('wikiLinkMarker')
      effects.exit('wikiLink')
      return ok
    }
  }
}

/** micromark syntax extension. Extensions run before the built-ins, so [[x]] beats a link label. */
export function wikiLinkSyntax(): Extension {
  return { text: { [LEFT]: construct(false), [BANG]: construct(true) } }
}

/** The parts of the text between the brackets. "\|" divides too (Obsidian's form inside tables). */
export function parseWikiValue(raw: string): WikiParts {
  const bar = raw.indexOf('|')
  const left = bar === -1 ? raw : raw.slice(0, bar).replace(/\\$/, '')
  const hash = left.indexOf('#')
  return {
    target: (hash === -1 ? left : left.slice(0, hash)).trim(),
    heading: hash === -1 ? null : left.slice(hash + 1).trim(),
    alias: bar === -1 ? null : raw.slice(bar + 1).replace(/\\\|/g, '|').trim(),
  }
}

/** Whether "[[raw]]" parses as a wiki link: the tokenizer's rules, for text typed in the editor. */
export function isWikiValue(raw: string): boolean {
  if (/[[\]`\r\n]/.test(raw)) return false
  const bar = raw.indexOf('|')
  return /\S/.test(bar === -1 ? raw : raw.slice(0, bar).replace(/\\$/, ''))
}

/** What a link shows: its alias, else the target (and heading) as written. An embed's "alias" is its size. */
export function wikiLabel(raw: string, embed = false): string {
  const { target, heading, alias } = parseWikiValue(raw)
  return (!embed && alias) || [target, heading].filter(Boolean).join(' › ') || raw
}

export function wikiLinkFromMarkdown(): FromMarkdownExtension {
  return {
    enter: {
      wikiLink(this: CompileContext, token: Token) {
        this.enter({ type: 'wikiLink', value: '', embed: false, target: '', heading: null, alias: null }, token)
      },
    },
    exit: {
      wikiLinkValue(this: CompileContext, token: Token) {
        const node = this.stack[this.stack.length - 1] as WikiLink
        node.value = this.sliceSerialize(token)
      },
      wikiLink(this: CompileContext, token: Token) {
        const node = this.stack[this.stack.length - 1] as WikiLink
        node.embed = this.sliceSerialize(token).startsWith('!')
        Object.assign(node, parseWikiValue(node.value))
        this.exit(token)
      },
    },
  }
}

// Written back exactly as read, never through state.safe(), which would
// escape the brackets and any "_" or "*" in the target.
function wikiLink(node: WikiLink, _parent: unknown, state: Serializer) {
  // In a GFM table a bare "|" would split the cell; Obsidian writes "\|" there.
  const raw = state.stack.includes('tableCell') ? node.value.replace(/(?<!\\)\|/g, '\\|') : node.value
  return `${node.embed ? '!' : ''}[[${raw}]]`
}
// What the link starts with, so text before it is escaped to match: a "!"
// right before [[x]] is written "\!", or it would turn the link into an embed.
wikiLink.peek = (node: WikiLink) => (node.embed ? '!' : '[')

export function wikiLinkToMarkdown(): ToMarkdownExtension {
  return { handlers: { wikiLink } }
}

// unified's processor data, as remark-parse and remark-stringify read it.
type RemarkData = { micromarkExtensions?: unknown[]; fromMarkdownExtensions?: unknown[]; toMarkdownExtensions?: unknown[] }

/** remark plugin: wiki links when parsing and when stringifying. */
export function remarkWikiLink(this: { data(): RemarkData }) {
  const data = this.data()
  ;(data.micromarkExtensions ??= []).push(wikiLinkSyntax())
  ;(data.fromMarkdownExtensions ??= []).push(wikiLinkFromMarkdown())
  ;(data.toMarkdownExtensions ??= []).push(wikiLinkToMarkdown())
}
