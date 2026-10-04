// The one markdown parser behind the view and every line edit, so the line
// the page shows as a task is the line the server ticks. Server-only: the
// micromark bundle is too big for the browser.
import { fromMarkdown } from 'mdast-util-from-markdown'
import { frontmatterFromMarkdown } from 'mdast-util-frontmatter'
import { frontmatter } from 'micromark-extension-frontmatter'
import { gfm } from 'micromark-extension-gfm'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import type { Root } from 'mdast'
import { wikiLinkFromMarkdown, wikiLinkSyntax } from './wikilink'

// Syntax extensions and their mdast counterparts, in matching order. New
// syntax (math) goes on the end of both lists. Frontmatter is "yaml" only:
// lib/frontmatter.ts finds the same block without a parser. Wiki links are
// inline, so they never move a line.
const extensions = [gfm(), frontmatter('yaml'), wikiLinkSyntax()]
const mdastExtensions = [gfmFromMarkdown(), frontmatterFromMarkdown('yaml'), wikiLinkFromMarkdown()]

export function parseMarkdown(content: string): Root {
  return fromMarkdown(content, { extensions, mdastExtensions })
}
