// The one markdown parser behind the view and every line edit, so the line
// the page shows as a task is the line the server ticks. Server-only: the
// micromark bundle is too big for the browser.
import { fromMarkdown } from 'mdast-util-from-markdown'
import { frontmatterFromMarkdown } from 'mdast-util-frontmatter'
import { frontmatter } from 'micromark-extension-frontmatter'
import { gfm } from 'micromark-extension-gfm'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import type { Root } from 'mdast'

// Syntax extensions and their mdast counterparts, in matching order. New
// syntax (wiki links, math) goes on the end of both lists. Frontmatter is
// "yaml" only: lib/frontmatter.ts finds the same block without a parser.
const extensions = [gfm(), frontmatter('yaml')]
const mdastExtensions = [gfmFromMarkdown(), frontmatterFromMarkdown('yaml')]

export function parseMarkdown(content: string): Root {
  return fromMarkdown(content, { extensions, mdastExtensions })
}
