import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { cookies } from 'next/headers'
import { after } from 'next/server'
import {
  currentSnapshot,
  GitHubError,
  getLastUpdated,
  getNotesFile,
  getTokenExpiration,
  isNotePath,
  isValidSession,
  lastReviewed,
  lastUpdated,
  listVault,
  notesConfig,
  noteName,
  readNote,
  SESSION_COOKIE,
  TODO_FILE,
  warmSnapshot,
} from '@/lib/notes'
import { tokenExpiryWarning, type TokenWarning } from '@/lib/token-expiry'
import ActionButton from '../ActionButton'
import NotesView from '../NotesView'
import ReviewBanner from '../ReviewBanner'
import InlineAdd from '../InlineAdd'
import VaultTree, { buildTree } from '../VaultTree'
import QuickSwitcher from '../QuickSwitcher'
import TodayButton from '../TodayButton'
import { renderNote } from '../Markdown'

type Params = Promise<{ path?: string[] }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  // Only derived from the URL the requester already typed — nothing fetched pre-auth.
  const path = decodePath((await params).path)
  return { title: path ? noteName(path) : 'notes', robots: { index: false, follow: false } }
}

// Without this, a build with env vars absent never reaches cookies() and Next
// prerenders the "not configured" branch as a static page.
export const dynamic = 'force-dynamic'

function decodePath(segs: string[] | undefined) {
  return (segs ?? [])
    .map(s => {
      try {
        return decodeURIComponent(s)
      } catch {
        return s
      }
    })
    .join('/')
}

export default async function NotesPage({
  params,
  searchParams,
}: {
  params: Params
  searchParams: Promise<{ error?: string; edit?: string }>
}) {
  const { missing, repo } = notesConfig()
  if (missing.length) {
    return <Single><Notice>Not configured. Missing env: {missing.join(', ')}</Notice></Single>
  }

  const { error, edit } = await searchParams
  const session = (await cookies()).get(SESSION_COOKIE)?.value
  if (!isValidSession(session)) {
    return <Single><Login error={Boolean(error)} /></Single>
  }

  const requested = decodePath((await params).path)
  if (requested && !isNotePath(requested)) {
    return <Single authed><Notice>Not a note path: {requested}</Notice></Single>
  }

  // A warm server reads the vault from memory: one conditional request, free
  // when nothing changed. A cold one reads file by file and fills the snapshot
  // after answering.
  const snap = await currentSnapshot()
  if (!snap) after(warmSnapshot)
  const loadVault = () => (snap ? Promise.resolve({ notes: snap.notes.map(e => e.path), folders: snap.folders }) : listVault())
  const noteFetch = (p: string) => {
    const held = snap && readNote(snap, p)
    if (held) return Promise.all([held, lastUpdated(p, held.sha, () => getLastUpdated(p))])
    return Promise.all([getNotesFile(p), getLastUpdated(p)])
  }

  // Fetch the tree and (when the URL names one) the note in parallel.
  let vault: Awaited<ReturnType<typeof loadVault>>
  let note: Awaited<ReturnType<typeof noteFetch>> | null = null
  let noteError: unknown = null
  const settle = (p: Promise<Awaited<ReturnType<typeof noteFetch>>>) =>
    p.then(r => { note = r }, e => { noteError = e })

  try {
    if (requested) {
      ;[vault] = await Promise.all([loadVault(), settle(noteFetch(requested))])
    } else {
      vault = await loadVault()
    }
  } catch (err) {
    return (
      <Single authed>
        <Notice>
          Couldn&apos;t load your notes from GitHub.
          <br />
          <span className="text-stone-500">{err instanceof Error ? err.message : 'Unknown error'}</span>
        </Notice>
      </Single>
    )
  }

  const file = requested || (vault.notes.includes(TODO_FILE) ? TODO_FILE : vault.notes[0] ?? null)
  if (file && !requested) await settle(noteFetch(file))
  const tree = buildTree(vault.notes, vault.folders)
  // The vault read just heard from GitHub, so the token's expiry is current.
  const tokenWarning = tokenExpiryWarning(getTokenExpiration())

  let body: ReactNode
  if (!file) {
    body = <Notice>No notes yet. Create one with “+ new note”.</Notice>
  } else if (!note) {
    const notFound = noteError instanceof GitHubError && noteError.status === 404
    body = notFound ? (
      <div className="mt-8 flex flex-wrap items-center gap-4">
        <p className="text-sm text-stone-700">{file} doesn&apos;t exist yet.</p>
        <ActionButton
          url="/api/notes/create"
          body={{ kind: 'note', name: file }}
          className="h-11 px-4 rounded-md bg-stone-900 text-stone-50 text-sm font-medium active:bg-stone-700 disabled:opacity-50"
        >
          create it
        </ActionButton>
      </div>
    ) : (
      <Notice>
        Couldn&apos;t load {file} from GitHub.
        <br />
        <span className="text-stone-500">{noteError instanceof Error ? noteError.message : 'Unknown error'}</span>
      </Notice>
    )
  } else {
    const [{ content, sha }, updated] = note as Awaited<ReturnType<typeof noteFetch>>
    const meta = (
      <>
        {updated ? (
          <time dateTime={updated} title={new Date(updated).toUTCString()}>
            updated {relativeTime(updated)}
          </time>
        ) : (
          'last update unknown'
        )}
        {' · '}
        <a href={`https://github.com/${repo}/blob/HEAD/${file}`} className="underline underline-offset-2 hover:text-stone-700">
          GitHub
        </a>
        {' · '}
        <ActionButton
          url="/api/notes/delete"
          body={{ file, kind: 'note' }}
          confirmText={`Delete the note “${noteName(file)}”? (It stays recoverable in the repo's git history.)`}
          redirect="/notes"
          className="underline underline-offset-2 hover:text-red-700"
        >
          delete note
        </ActionButton>
      </>
    )
    body = (
      <NotesView key={file} file={file} content={content} sha={sha} meta={meta} startEditing={edit === '1'}>
        {file === TODO_FILE && <ReviewBanner {...reviewStatus(content)} />}
        <div className="text-[16px] leading-relaxed text-stone-800">{renderNote(content, file)}</div>
        <div className="mt-10 pt-4 border-t border-stone-200">
          <InlineAdd
            trigger="new section"
            placeholder="Section name, e.g. Reading list"
            url="/api/notes/section"
            body={{ file }}
            field="title"
          />
        </div>
      </NotesView>
    )
  }

  const crumbs = file ? file.replace(/\.md$/i, '').split('/') : []

  return (
    <main className="max-w-5xl mx-auto px-5 pt-6 pb-24 md:grid md:grid-cols-[13rem_minmax(0,1fr)] md:gap-10">
      <aside className="hidden md:block pt-1">
        <SignOut />
        {/* The only instance that owns ⌘K — the phone row below is a second trigger. */}
        <div className="flex gap-2 mt-2 mb-3">
          <QuickSwitcher notes={vault.notes} shortcut className="flex-1" />
          <TodayButton notes={vault.notes} />
        </div>
        <VaultTree tree={tree} current={file} />
      </aside>
      <section className="min-w-0 max-w-2xl">
        {tokenWarning && <TokenBanner {...tokenWarning} />}
        {/* Phone: search + today always visible; the tree lives in a drawer. */}
        <div className="md:hidden flex gap-2 mb-2">
          <QuickSwitcher notes={vault.notes} className="flex-1" />
          <TodayButton notes={vault.notes} />
        </div>
        <details className="md:hidden mb-4 rounded-md border border-stone-200 bg-white px-3 [&[open]]:pb-3">
          <summary className="flex items-center justify-between min-h-11 cursor-pointer select-none text-sm text-stone-600 list-none [&::-webkit-details-marker]:hidden">
            <span>☰ files</span>
            <SignOut />
          </summary>
          <VaultTree tree={tree} current={file} />
        </details>
        <h1 className="mb-1 text-sm text-stone-400 truncate">
          {crumbs.map((c, i) => (
            <span key={i} className={i === crumbs.length - 1 ? 'text-stone-900 font-medium' : ''}>
              {i > 0 && <span className="mx-1.5 text-stone-300">/</span>}
              {c}
            </span>
          ))}
        </h1>
        {body}
      </section>
    </main>
  )
}

// ── Layout pieces ───────────────────────────────────────────

function Single({ children, authed = false }: { children: ReactNode; authed?: boolean }) {
  return (
    <main className="max-w-2xl mx-auto px-5 pt-8 pb-24">
      <header className="flex items-center justify-between mb-2">
        <h1 className="text-sm font-medium text-stone-900">notes</h1>
        {authed && <SignOut />}
      </header>
      {children}
    </main>
  )
}

function SignOut() {
  return (
    <form action="/api/notes/logout" method="post" className="inline">
      <button className="text-xs text-stone-400 hover:text-stone-900 py-2 px-2 -mx-2">sign out</button>
    </form>
  )
}

function Notice({ children }: { children: ReactNode }) {
  return <p className="mt-8 text-sm text-stone-700 leading-relaxed">{children}</p>
}

function TokenBanner({ days, date }: TokenWarning) {
  return (
    <p role="status" className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-relaxed text-amber-900">
      GitHub token {days === 0 ? `expired on ${date}` : `expires in ${days} day${days === 1 ? '' : 's'} (${date})`}.{' '}
      {/* Vertical padding on an inline link grows the tap target to 44px without moving the text. */}
      <a href="https://github.com/settings/personal-access-tokens" className="py-3.5 underline underline-offset-2">
        Generate a new one
      </a>{' '}
      and update GITHUB_TOKEN in Vercel.
    </p>
  )
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
