// YAML frontmatter, found exactly where the parser (lib/markdown.ts) finds it,
// but with no dependencies, so client code can use it too. Following
// micromark-extension-frontmatter: the file opens with a "---" line (after an
// optional BOM) and the first later "---" line closes it. Either fence may end
// in spaces or tabs. With no closing fence there is no frontmatter, and "..."
// never closes it.

export type Frontmatter = {
  /** Both fences, the YAML between them and the closing line ending; '' if none. */
  frontmatter: string
  /** The rest of the file: frontmatter + body === content. */
  body: string
  /** Lines the frontmatter spans (0 if none): the body starts on line lines + 1. */
  lines: number
}

const FENCE_RE = /^---[ \t]*$/

export function splitFrontmatter(content: string): Frontmatter {
  // Line endings as micromark counts them, so `lines` matches node positions.
  const eol = /\r\n|\r|\n/g
  eol.lastIndex = content.startsWith('\uFEFF') ? 1 : 0
  let start = eol.lastIndex
  for (let n = 1; ; n++) {
    const m = eol.exec(content)
    const fence = FENCE_RE.test(content.slice(start, m?.index))
    if (n === 1 && !(fence && m)) break // no opening fence, or nothing after it
    if (n > 1 && fence) {
      const end = m ? eol.lastIndex : content.length
      return { frontmatter: content.slice(0, end), body: content.slice(end), lines: n }
    }
    if (!m) break // never closed
    start = eol.lastIndex
  }
  return { frontmatter: '', body: content, lines: 0 }
}
