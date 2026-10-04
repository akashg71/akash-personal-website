'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { splitFrontmatter } from '@/lib/frontmatter'
import { mutate } from './mutate'

const RichEditor = dynamic(() => import('./RichEditor'), {
  ssr: false,
  loading: () => <p className="py-8 text-sm text-stone-400">loading editor…</p>,
})

type Mode = 'view' | 'rich' | 'source'

/**
 * Rendered view ⇄ editor. "rich" is Milkdown Crepe (WYSIWYG markdown, like
 * Obsidian's live preview); "source" is the raw file. Both edit one `draft`.
 * Saving sends the sha the editor was opened on and never retries: if the file
 * changed meanwhile the server refuses (409) and the draft stays here.
 */
export default function NotesView({
  file,
  content,
  sha,
  meta,
  startEditing = false,
  children,
}: {
  file: string
  content: string
  sha: string
  meta: ReactNode
  /** Open in the rich editor (new notes arrive with ?edit=1). */
  startEditing?: boolean
  children: ReactNode
}) {
  const router = useRouter()
  // ?edit=1 → straight into the editor with the cursor ready. Set as the initial
  // state rather than by an effect, so there's no flash of the view first.
  const [mode, setMode] = useState<Mode>(startEditing ? 'rich' : 'view')
  const [focusEditor, setFocusEditor] = useState(startEditing)
  // Nothing but the "# Title" line (and any frontmatter) → show a "Start writing" prompt instead.
  const empty = splitFrontmatter(content).body.trimStart().replace(/^#[^\n]*\n?/, '').trim() === ''
  const [draft, setDraft] = useState(content)
  const [base, setBase] = useState({ content, sha }) // what the editor was opened on
  const [richSeed, setRichSeed] = useState(content) // what the rich editor (re)mounts with
  // "Dirty" is a string comparison, not an event flag: the editor emits updates
  // while it settles, and its serialization of an untouched file can differ from
  // the file (whitespace etc.). Baseline = the editor's own first serialization.
  const [baseline, setBaseline] = useState(content)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editing = mode !== 'view'
  const dirty = editing && draft !== baseline

  // Don't lose an unsaved edit to a stray back-swipe or tab close.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  function open(focus = false) {
    setBase({ content, sha })
    setDraft(content)
    setRichSeed(content)
    setBaseline(content)
    setError(null)
    setFocusEditor(focus)
    setMode('rich')
  }

  // Drop ?edit=1 from the URL so a reload or the refresh after saving doesn't
  // reopen the editor.
  useEffect(() => {
    if (startEditing) window.history.replaceState(null, '', window.location.pathname)
  }, [startEditing])

  function cancel() {
    if (dirty && !window.confirm('Discard your changes?')) return
    setMode('view')
  }

  function switchTo(next: Mode) {
    if (next === 'rich') setRichSeed(draft) // remount the rich editor on the source edits
    setMode(next)
  }

  const save = useCallback(() => {
    if (!dirty) return setMode('view')
    setPending(true)
    setError(null)
    mutate('/api/notes/save', { file, content: draft, sha: base.sha })
      .then(() => {
        setBaseline(draft)
        setMode('view')
        router.refresh()
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Save failed'))
      .finally(() => setPending(false))
  }, [dirty, draft, base.sha, file, router])

  useEffect(() => {
    if (!editing) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, save])

  const quiet = 'min-h-11 px-2 text-xs text-stone-500 hover:text-stone-900'
  const tab = (m: Mode, label: string) => (
    <button
      onClick={() => switchTo(m)}
      className={`min-h-9 px-3 text-xs rounded ${mode === m ? 'bg-white shadow-sm text-stone-900' : 'text-stone-500'}`}
    >
      {label}
    </button>
  )

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mb-6">
        <div className="text-xs text-stone-400">{meta}</div>
        {editing ? (
          <div className="flex items-center gap-1 -mr-2">
            <div className="flex rounded-md bg-stone-100 p-0.5 mr-1">
              {tab('rich', 'rich')}
              {tab('source', 'source')}
            </div>
            <button onClick={cancel} disabled={pending} className={quiet}>cancel</button>
            <button
              onClick={save}
              disabled={pending}
              className="h-9 px-3 rounded-md bg-stone-900 text-stone-50 text-xs font-medium active:bg-stone-700 disabled:opacity-50"
            >
              {pending ? 'saving…' : dirty ? 'save' : 'done'}
            </button>
          </div>
        ) : (
          <button
            onClick={() => open()}
            className="h-9 px-3 rounded-md border border-stone-300 bg-white text-xs font-medium text-stone-700 hover:border-stone-500 hover:text-stone-900"
          >
            ✎ Edit
          </button>
        )}
      </div>

      {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}

      {mode === 'rich' && (
        <div className="-mx-2 rounded-md border border-stone-200 bg-white">
          <RichEditor
            initial={richSeed}
            autoFocus={focusEditor}
            onReady={md => {
              // First mount on an untouched file: adopt the editor's serialization as
              // the baseline. A remount after source edits keeps the user's draft.
              if (draft === baseline) {
                setBaseline(md)
                setDraft(md)
              }
            }}
            onChange={setDraft}
          />
        </div>
      )}

      {mode === 'source' && (
        <div>
          {/* text-base (16px) stops iOS zoom; spellcheck off so code/tickers aren't underlined */}
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            spellCheck={false}
            rows={Math.max(16, draft.split('\n').length + 2)}
            className="w-full p-3 font-mono text-base leading-relaxed rounded-md border border-stone-300 bg-white focus:outline-none focus:border-stone-500 resize-y"
          />
          <p className="mt-2 text-xs text-stone-400">
            Markdown: <code>## Section</code>, <code>- [ ] task</code>, indent two spaces to nest.
          </p>
        </div>
      )}

      {mode === 'view' && empty && (
        <button
          onClick={() => open(true)}
          className="w-full mb-6 rounded-md border border-dashed border-stone-300 py-8 text-sm text-stone-500 hover:border-stone-500 hover:text-stone-800"
        >
          Empty note — <span className="underline underline-offset-2">start writing</span>
          <span className="block mt-1 text-xs text-stone-400">headings, bold, lists, checklists, tables, code</span>
        </button>
      )}
      {mode === 'view' && children}
    </>
  )
}
