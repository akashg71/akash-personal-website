import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { cookies } from 'next/headers'
import type { Nodes, List, ListItem } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfm } from 'micromark-extension-gfm'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import {
  GitHubError,
  getLastUpdated,
  getNotesFile,
  isValidSession,
  lastReviewed,
  notesConfig,
  NOTES_FILES,
  REVIEW_LINE_RE,
  SESSION_COOKIE,
  type NotesFile,
} from '@/lib/notes'
import TaskItem from './TaskItem'
import ReviewBanner from './ReviewBanner'
import QuickAdd from './QuickAdd'

export const metadata: Metadata = {
  title: 'notes',
  robots: { index: false, follow: false },
}

// Without this, a build with env vars absent never reaches cookies() and Next
// prerenders the "not configured" branch as a static page.
export const dynamic = 'force-dynamic'

export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; f?: string }>
}) {
  const { missing, repo } = notesConfig()
  if (missing.length) {
    return <Shell><Notice>Not configured. Missing env: {missing.join(', ')}</Notice></Shell>
  }

  const { error, f } = await searchParams
  const session = (await cookies()).get(SESSION_COOKIE)?.value
  if (!isValidSession(session)) {
    return <Shell><Login error={Boolean(error)} /></Shell>
  }

  const file: NotesFile = f === 'progress' ? NOTES_FILES.progress : NOTES_FILES.todo
  const tabs = <Tabs active={file} />

  let content: string
  let updated: string | null
  try {
    const [res, date] = await Promise.all([getNotesFile(file), getLastUpdated(file)])
    content = res.content
    updated = date
  } catch (err) {
    const missingFile = err instanceof GitHubError && err.status === 404 && file !== NOTES_FILES.todo
    return (
      <Shell authed>
        {tabs}
        {missingFile ? (
          <Notice>
            {file} doesn&apos;t exist yet.{' '}
            <a
              href={`https://github.com/${repo}/new/main?filename=${file}`}
              className="underline underline-offset-2"
            >
              Create it on GitHub
            </a>
            .
          </Notice>
        ) : (
          <Notice>
            Couldn&apos;t load {file} from GitHub.
            <br />
            <span className="text-stone-500">{err instanceof Error ? err.message : 'Unknown error'}</span>
          </Notice>
        )}
      </Shell>
    )
  }

  const tree = fromMarkdown(content, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  })
  const ctx: Ctx = { lines: content.split('\n'), file }

  return (
    <Shell authed>
      {tabs}
      <p className="text-xs text-stone-400 mb-6">
        {updated ? (
          <time dateTime={updated} title={new Date(updated).toUTCString()}>
            updated {relativeTime(updated)}
          </time>
        ) : (
          'last update unknown'
        )}
        {' · '}
        <a
          href={`https://github.com/${repo}/blob/HEAD/${file}`}
          className="underline underline-offset-2 hover:text-stone-700"
        >
          open on GitHub
        </a>
      </p>
      {file === NOTES_FILES.todo && (
        <>
          <ReviewBanner {...reviewStatus(content)} />
          <QuickAdd />
        </>
      )}
      <div className="text-[16px] leading-relaxed text-stone-800">{render(tree, ctx)}</div>
    </Shell>
  )
}

// ── Layout pieces ───────────────────────────────────────────

function Shell({ children, authed = false }: { children: ReactNode; authed?: boolean }) {
  return (
    <main className="max-w-2xl mx-auto px-5 pt-8 pb-24">
      <header className="flex items-center justify-between mb-2">
        <h1 className="text-sm font-medium text-stone-900">notes</h1>
        {authed && (
          <form action="/api/notes/logout" method="post">
            <button className="text-xs text-stone-400 hover:text-stone-900 py-2 px-2 -mr-2">sign out</button>
          </form>
        )}
      </header>
      {children}
    </main>
  )
}

function Tabs({ active }: { active: NotesFile }) {
  const tab = (href: string, file: NotesFile, label: string) => (
    <Link
      href={href}
      className={`inline-flex items-center h-11 px-1 border-b-2 ${
        active === file ? 'border-stone-900 text-stone-900' : 'border-transparent text-stone-400 hover:text-stone-700'
      }`}
    >
      {label}
    </Link>
  )
  return (
    <nav className="flex gap-6 mb-4 text-sm border-b border-stone-200">
      {tab('/notes', NOTES_FILES.todo, 'todo')}
      {tab('/notes?f=progress', NOTES_FILES.progress, 'progress')}
    </nav>
  )
}

function Notice({ children }: { children: ReactNode }) {
  return <p className="mt-8 text-sm text-stone-700 leading-relaxed">{children}</p>
}

function Login({ error }: { error: boolean }) {
  return (
    <form action="/api/notes/login" method="post" className="mt-10 flex flex-col gap-3 max-w-xs">
      {/* text-base (16px) on the input stops iOS Safari zooming on focus */}
      <input
        type="password"
        name="password"
        autoComplete="current-password"
        autoFocus
        required
        placeholder="password"
        className="h-12 px-3 text-base rounded-md border border-stone-300 bg-white focus:outline-none focus:border-stone-500"
      />
      <button className="h-12 rounded-md bg-stone-900 text-stone-50 text-sm font-medium active:bg-stone-700">
        open
      </button>
      {error && <p role="alert" className="text-sm text-red-700">Wrong password.</p>}
    </form>
  )
}

function relativeTime(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function reviewStatus(content: string) {
  const last = lastReviewed(content)
  if (!last) return { last: null, days: null }
  // Server clock is UTC and the stamp is the client's local date, so this can be
  // a day off around midnight — clamp so it never shows "-1 days ago".
  const today = Date.parse(new Date().toISOString().slice(0, 10))
  return { last, days: Math.max(0, Math.round((today - Date.parse(last)) / 86_400_000)) }
}

// ── mdast → React ───────────────────────────────────────────
// Deliberately not MDX: these files are data, not code. A stray `{` or `<` must
// not break rendering, and raw HTML nodes are shown as text, never injected.

type Ctx = { lines: string[]; file: NotesFile }

function safeHref(url: string) {
  return /^(https?:|mailto:|\/|#)/i.test(url) ? url : undefined
}

function render(node: Nodes, ctx: Ctx, tight = false, key?: number): ReactNode {
  const kids = (n: { children: Nodes[] }, childTight = tight) =>
    n.children.map((c, i) => render(c, ctx, childTight, i))

  switch (node.type) {
    case 'root':
      return kids(node)
    case 'heading': {
      const cls = [
        '',
        'text-xl font-semibold text-stone-900 mt-10 mb-3',
        'text-lg font-semibold text-stone-900 mt-10 mb-2 pb-1 border-b border-stone-200',
        'text-base font-semibold text-stone-900 mt-7 mb-2',
      ][node.depth] ?? 'text-sm font-semibold text-stone-700 mt-6 mb-1 uppercase tracking-wide'
      const Tag = `h${Math.min(node.depth + 1, 6)}` as 'h2' // page owns the single h1
      return <Tag key={key} className={`${cls} first:mt-0`}>{kids(node)}</Tag>
    }
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
          {kids(node)}
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
      return node.alt ?? ''
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
    <TaskItem key={`${line}:${raw}`} file={ctx.file} line={line} raw={raw} initialChecked={li.checked} label={label}>
      {body.length ? body : undefined}
    </TaskItem>
  )
}
