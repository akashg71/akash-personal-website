// YAML frontmatter values for the properties block. Server-only: the `yaml`
// package is big and never needs to reach the browser.
import { isMap, isScalar, parseDocument, type Document, type Node } from 'yaml'

export type Scalar = string | number | boolean | null
/** A scalar, a list of scalars, or (maps, nested lists) the value's own YAML. */
export type PropertyValue = Scalar | Scalar[] | { yaml: string }
export type Property = { key: string; value: PropertyValue }
export type Properties = { list: Property[]; error: null } | { list: null; error: string }

/** `yaml` is the text between the fences, as in the parser's yaml node. */
export function parseProperties(yaml: string): Properties {
  // Markdown ends a line at a lone \r (old Mac files); the yaml package reads it as text.
  const src = yaml.replace(/\r(?!\n)/g, '\n')
  // Silent: a note's YAML must never write warnings into the server log.
  const doc = parseDocument(src, { logLevel: 'silent', prettyErrors: false })
  const [err] = doc.errors
  // Report file lines: the opening fence is line 1.
  if (err) return fail(`${err.message} (line ${src.slice(0, err.pos[0]).split('\n').length + 1})`)
  if (doc.contents === null) return { list: [], error: null }
  if (!isMap(doc.contents)) return fail('Properties must be “key: value” lines')
  try {
    const list = doc.contents.items.map(({ key, value }) => ({
      key: isScalar(key) ? String(key.value) : key ? source(src, key as Node) : '',
      value: toValue(src, doc, value as Node | null),
    }))
    return { list, error: null }
  } catch (e) {
    // toJS throws on an alias bomb, or an alias to a missing anchor.
    return fail(e instanceof Error ? e.message : 'Unreadable YAML')
  }
}

const fail = (error: string): Properties => ({ list: null, error })

function toValue(src: string, doc: Document, node: Node | null): PropertyValue {
  if (!node) return null // "key:" and nothing after it
  const js: unknown = node.toJS(doc, { maxAliasCount: 100 })
  const value = scalarOf(js)
  if (value !== undefined) return value
  if (Array.isArray(js)) {
    const items = js.map(scalarOf)
    if (!items.includes(undefined)) return items as Scalar[]
  }
  return { yaml: source(src, node) }
}

function scalarOf(v: unknown): Scalar | undefined {
  if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  // Only an explicit !!timestamp makes a Date: plain dates stay strings.
  if (v instanceof Date) return v.toISOString().replace(/T00:00:00\.000Z$/, '')
  // An unquoted [[Note]] is YAML for a list inside a list: keep it as written.
  if (Array.isArray(v) && v.length === 1 && Array.isArray(v[0]) && v[0].length === 1 && typeof v[0][0] === 'string') {
    return `[[${v[0][0]}]]`
  }
  return undefined
}

/** A node's source text, later lines dedented by its first line's column. */
function source(src: string, node: Node) {
  const [start, end] = node.range ?? [0, 0]
  const column = start - (src.lastIndexOf('\n', start - 1) + 1)
  return src
    .slice(start, end)
    .trimEnd()
    .split('\n')
    .map((line, i) => (i ? line.replace(/^ +/, s => s.slice(column)) : line))
    .join('\n')
}

/**
 * The tags of a `tags` (or `tag`) property, which Obsidian reads from a list
 * or an "a, b" string, with or without a leading #. Null for any other property.
 */
export function tagsOf({ key, value }: Property): string[] | null {
  if (!/^tags?$/i.test(key)) return null
  const words =
    typeof value === 'string' ? value.split(/[\s,]+/) :
    Array.isArray(value) ? value.filter(v => v !== null).map(String) :
    value === null ? [] :
    null
  return words && words.map(w => w.trim().replace(/^#/, '')).filter(Boolean)
}

const DATE_RE = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/

/** "2026-10-04" → "4 Oct 2026", with any time as written ("…, 09:30"); null unless a real date. */
export function readableDate(value: string): string | null {
  const m = DATE_RE.exec(value)
  const day = m ? new Date(`${m[1]}T00:00:00Z`) : null
  if (!m || !day || Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== m[1]) return null
  const text = day.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  return m[2] ? `${text}, ${m[2]}` : text
}
