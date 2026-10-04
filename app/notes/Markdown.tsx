// mdast → React for the /notes view mode (server component module).
// Deliberately not MDX: notes are data, not code. A stray `{` or `<` must not
// break rendering, and raw HTML nodes are shown as text, never injected.
import type { ReactNode } from 'react'
import type { Heading, Image, Nodes, List, ListItem, Root, WikiLink } from 'mdast'
import { type AssetIndex, imageSrc, imageType, imageUrl, imageWidth, resolveEmbed, splitAlt } from '@/lib/assets'
import { headingTitle, parseMarkdown, REVIEW_LINE_RE, taskSource, taskText } from '@/lib/notes'
import { addKey, sectionsKey } from '@/lib/optimistic'
import ActionButton from './ActionButton'
import EditableText from './EditableText'
import InlineAdd from './InlineAdd'
import NoteImage from './NoteImage'
import { PendingItems, PendingSections } from './Pending'
import Properties from './Properties'
import TaskItem from './TaskItem'

type Ctx = { lines: string[]; file: string; sha: string; assets: AssetIndex; inLink?: boolean }
type SectionRef = { line: number; raw: string }

/**
 * `sha` is the file version being rendered: optimistic changes hide once it
 * includes them. `assets` are the vault's images, which the note's images
 * resolve against.
 */
export function renderNote(content: string, file: string, sha: string, assets: AssetIndex = new Map()): ReactNode[] {
  return renderRoot(parseMarkdown(content), { lines: content.split('\n'), file, sha, assets })
}

function safeHref(url: string) {
  return /^(https?:|mailto:|\/|#)/i.test(url) ? url : undefined
}

/**
 * Top level: render each node, and after each ##+ section's own content (i.e.
 * just before the next heading of any level, or at the end) put a "+ add item"
 * for that section. lib/notes.ts addToSection inserts at exactly that point,
 * so items still saving show there too. The h1 gets none — it's the title.
 * Sections still saving show where addSection puts them: before the first
 * "Inbox" heading, else at the end.
 */
function renderRoot(root: Root, ctx: Ctx): ReactNode[] {
  const out: ReactNode[] = []
  const seen = new Map<string, number>()
  let section: SectionRef | null = null
  // "+ add item" (which appends a "- [ ]") only fits checklist sections. Prose
  // sections — paragraphs, plain bullets — are edited in the editor instead, so
  // they don't get a todo button. Empty sections get one (a fresh "## Today").
  let sectionEmpty = true
  let sectionHasTasks = false
  let sectionLast: Root['children'][number] | null = null // where addToSection appends
  const sectionSlot = <PendingSections key="pending-sections" overlayKey={sectionsKey(ctx.file)} sha={ctx.sha} />
  let slotPlaced = false

  const flush = () => {
    if (!section || !(sectionEmpty || sectionHasTasks)) return
    // Keyed by heading text (not line) so an open input survives the refresh
    // after an add shifts every line below it.
    const n = (seen.get(section.raw) ?? 0) + 1
    seen.set(section.raw, n)
    const key = addKey(ctx.file, section.raw, n)
    out.push(
      <div key={`add:${section.raw}:${n}`} className="mt-1 mb-2">
        <PendingItems
          overlayKey={key}
          sha={ctx.sha}
          joinsList={sectionLast?.type === 'list' && !sectionLast.ordered}
        />
        <InlineAdd
          trigger="add item"
          placeholder="New item"
          url="/api/notes/add"
          body={{ file: ctx.file, heading: section }}
          field="text"
          keepOpen
          optimistic={{ key, sha: ctx.sha }}
        />
      </div>,
    )
  }

  root.children.forEach((node, i) => {
    if (node.type === 'heading') {
      flush()
      const line = node.position?.start.line
      if (!slotPlaced && line && headingTitle(ctx.lines[line - 1] ?? '').toLowerCase() === 'inbox') {
        out.push(sectionSlot)
        slotPlaced = true
      }
      section = node.depth >= 2 && line ? { line, raw: ctx.lines[line - 1] ?? '' } : null
      sectionEmpty = true
      sectionHasTasks = false
      sectionLast = null
      if (section) return void out.push(renderSectionHeading(node, section, ctx, i))
    } else {
      // The review stamp paragraph isn't visible content.
      const stamp = node.type === 'paragraph' && REVIEW_LINE_RE.test(ctx.lines[(node.position?.start.line ?? 0) - 1]?.trimEnd() ?? '')
      if (!stamp) sectionEmpty = false
      if (node.type === 'list' && node.children.some(li => typeof li.checked === 'boolean')) sectionHasTasks = true
      sectionLast = node
    }
    out.push(render(node, ctx, false, i))
  })
  flush()
  if (!slotPlaced) out.push(sectionSlot)
  return out
}

const HEADING_CLS = [
  '',
  'text-xl font-semibold text-stone-900 mt-10 mb-3',
  'text-lg font-semibold text-stone-900 mt-10 mb-2 pb-1 border-b border-stone-200',
  'text-base font-semibold text-stone-900 mt-7 mb-2',
]

function headingTag(depth: number) {
  return `h${Math.min(depth + 1, 6)}` as 'h2' // the page owns the single h1
}

function renderHeading(node: Heading, ctx: Ctx, key?: number) {
  const cls = HEADING_CLS[node.depth] ?? 'text-sm font-semibold text-stone-700 mt-6 mb-1 uppercase tracking-wide'
  const Tag = headingTag(node.depth)
  return <Tag key={key} className={`${cls} first:mt-0`}>{node.children.map((c, i) => render(c, ctx, false, i))}</Tag>
}

/** ##+ heading: tap the text to rename, × to delete the section. */
function renderSectionHeading(node: Heading, ref: SectionRef, ctx: Ctx, key: number) {
  const cls = HEADING_CLS[node.depth] ?? 'text-sm font-semibold text-stone-700 mt-6 mb-1 uppercase tracking-wide'
  const Tag = headingTag(node.depth)
  const title = headingTitle(ref.raw)
  return (
    <Tag key={key} className={`${cls} first:mt-0 flex items-center justify-between gap-2`}>
      <EditableText file={ctx.file} kind="section" line={ref.line} raw={ref.raw} source={title} sha={ctx.sha} className="min-w-0">
        {node.children.map((c, i) => render(c, ctx, false, i))}
      </EditableText>
      <ActionButton
        url="/api/notes/delete"
        body={{ file: ctx.file, kind: 'section', ...ref }}
        confirmText={`Delete the “${title}” section and everything under it?`}
        ariaLabel={`Delete section ${title}`}
        className="size-11 -my-3 -mr-3 flex items-center justify-center text-lg font-normal leading-none text-stone-300 hover:text-red-700 active:text-red-700"
      >
        ×
      </ActionButton>
    </Tag>
  )
}

function render(node: Nodes, ctx: Ctx, tight = false, key?: number): ReactNode {
  const kids = (n: { children: Nodes[] }, childTight = tight) =>
    n.children.map((c, i) => render(c, ctx, childTight, i))

  switch (node.type) {
    case 'root':
      return kids(node)
    case 'yaml':
      return <Properties key={key} yaml={node.value} /> // frontmatter: only ever the first node
    case 'heading':
      return renderHeading(node, ctx, key)
    case 'paragraph': {
      // The "Last reviewed: …" stamp is shown by ReviewBanner, not inline.
      const pos = node.position
      if (pos && pos.start.line === pos.end.line && REVIEW_LINE_RE.test(ctx.lines[pos.start.line - 1]?.trimEnd() ?? '')) {
        return null
      }
      return tight ? <span key={key}>{kids(node)}</span> : <p key={key} className="my-3">{kids(node)}</p>
    }
    case 'text':
      return node.value
    case 'strong':
      return <strong key={key} className="font-semibold text-stone-900">{kids(node)}</strong>
    case 'emphasis':
      return <em key={key}>{kids(node)}</em>
    case 'delete':
      return <del key={key} className="text-stone-400">{kids(node)}</del>
    case 'inlineCode':
      return (
        <code key={key} className="px-1 py-0.5 rounded bg-stone-100 border border-stone-200 text-[0.875em]">
          {node.value}
        </code>
      )
    case 'code':
      return (
        <pre key={key} className="my-4 p-4 rounded-md bg-stone-900 text-stone-100 text-sm overflow-x-auto">
          <code>{node.value}</code>
        </pre>
      )
    case 'link': {
      const href = safeHref(node.url)
      return href ? (
        <a key={key} href={href} className="underline underline-offset-2 decoration-stone-400 hover:decoration-stone-900">
          {node.children.map((c, i) => render(c, { ...ctx, inLink: true }, tight, i))}
        </a>
      ) : (
        <span key={key}>{kids(node)}</span>
      )
    }
    case 'list':
      return renderList(node, ctx, key)
    case 'blockquote':
      return (
        <blockquote key={key} className="my-4 pl-4 border-l-2 border-stone-300 text-stone-600">
          {kids(node, false)}
        </blockquote>
      )
    case 'thematicBreak':
      return <hr key={key} className="my-8 border-stone-200" />
    case 'break':
      return <br key={key} />
    case 'html':
      return node.value
    case 'image':
      return renderImage(node, ctx, key)
    case 'wikiLink':
      return renderWikiLink(node, ctx, key)
    case 'table':
      return (
        <div key={key} className="my-4 overflow-x-auto">
          <table className="text-sm border-collapse">
            <tbody>{kids(node)}</tbody>
          </table>
        </div>
      )
    case 'tableRow':
      return <tr key={key} className="border-b border-stone-200">{kids(node, true)}</tr>
    case 'tableCell':
      return <td key={key} className="py-1.5 pr-4 align-top">{kids(node, true)}</td>
    default:
      return 'children' in node ? kids(node as { children: Nodes[] }) : null
  }
}

/** ![alt](src): an http(s) URL as is, a file in the vault through the image route. */
function renderImage(node: Image, ctx: Ctx, key?: number) {
  const { alt, width } = splitAlt(node.alt ?? '')
  const url = imageSrc(ctx.file, node.url, ctx.assets)
  if (url === null) return alt // data:, javascript: and the like stay text
  return <NoteImage key={key} url={url || null} alt={alt} width={width} missing={node.url} inLink={ctx.inLink} />
}

/** An Obsidian ![[image.png|300]] embed shows the image; other [[links]] stay as written for now. */
function renderWikiLink(node: WikiLink, ctx: Ctx, key?: number) {
  if (!node.embed || !imageType(node.target)) return `${node.embed ? '!' : ''}[[${node.value.replace(/\\\|/g, '|')}]]`
  const path = resolveEmbed(ctx.file, node.target, ctx.assets)
  const url = path && imageUrl(path, ctx.assets.get(path)!)
  const width = imageWidth(node.alias ?? '')
  const alt = (!width && node.alias) || node.target.replace(/^.*\//, '')
  return <NoteImage key={key} url={url} alt={alt} width={width} missing={node.target} inLink={ctx.inLink} />
}

function renderList(list: List, ctx: Ctx, key?: number) {
  const tight = !list.spread
  const allTasks = list.children.every(li => typeof li.checked === 'boolean')
  const items = list.children.map((li, i) => renderItem(li, ctx, tight, i))

  if (allTasks) return <ul key={key} className="my-2">{items}</ul>
  return list.ordered ? (
    <ol key={key} start={list.start ?? undefined} className="my-2 pl-6 list-decimal space-y-1">{items}</ol>
  ) : (
    <ul key={key} className="my-2 pl-6 list-disc space-y-1 marker:text-stone-400">{items}</ul>
  )
}

function renderItem(li: ListItem, ctx: Ctx, tight: boolean, key: number) {
  if (typeof li.checked !== 'boolean' || !li.position) {
    return <li key={key}>{li.children.map((c, i) => render(c, ctx, tight, i))}</li>
  }

  // The task marker sits on the item's first source line — that line number is
  // the write-back address. `raw` lets the server verify it before patching.
  const line = li.position.start.line
  const raw = ctx.lines[line - 1] ?? ''
  const [first, ...rest] = li.children
  const label = first?.type === 'paragraph' ? render(first, ctx, true) : null
  const body = (first?.type === 'paragraph' ? rest : li.children).map((c, i) => render(c, ctx, tight, i))

  // Keyed by line + raw (not index): after router.refresh() an item whose line
  // or state changed upstream remounts and picks up the server's checked state,
  // instead of a stale useState surviving on a different item.
  return (
    <TaskItem
      key={`${line}:${raw}`}
      file={ctx.file}
      line={line}
      raw={raw}
      title={taskText(raw)}
      source={taskSource(raw)}
      initialChecked={li.checked}
      sha={ctx.sha}
      label={label}
    >
      {body.length ? body : undefined}
    </TaskItem>
  )
}
