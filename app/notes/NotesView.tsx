'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { mutate } from './mutate'

/**
 * Rendered view ⇄ raw-markdown editor (Obsidian's "source mode"). The rendered
 * children are server-rendered and passed through untouched. Saving sends the
 * sha the editor was opened with; if the file changed meanwhile the server
 * refuses (409) and the text stays here so nothing is lost.
 */
export default function NotesView({
  file,
  content,
  sha,
  meta,
  children,
}: {
  file: string
  content: string
  sha: string
  meta: ReactNode
  children: ReactNode
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(content)
  const [base, setBase] = useState({ content, sha }) // what the editor was opened on
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = editing && draft !== base.content

  // Don't lose an unsaved edit to a stray back-swipe or tab close.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  function open() {
    setBase({ content, sha })
    setDraft(content)
    setError(null)
    setEditing(true)
  }

  function cancel() {
    if (dirty && !window.confirm('Discard your changes?')) return
    setEditing(false)
  }

  function save() {
    if (!dirty) return setEditing(false)
    setPending(true)
    setError(null)
    mutate('/api/notes/save', { file, content: draft, sha: base.sha })
      .then(() => {
        setEditing(false)
        router.refresh()
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Save failed'))
      .finally(() => setPending(false))
  }

  const toolbarBtn = 'min-h-11 px-2 -mr-2 text-xs text-stone-500 hover:text-stone-900'

  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="text-xs text-stone-400">{meta}</div>
        {editing ? (
          <div className="flex gap-1">
            <button onClick={cancel} disabled={pending} className={toolbarBtn}>cancel</button>
            <button
              onClick={save}
              disabled={pending}
              className="h-9 px-3 rounded-md bg-stone-900 text-stone-50 text-xs font-medium active:bg-stone-700 disabled:opacity-50"
            >
              {pending ? 'saving…' : 'save'}
            </button>
          </div>
        ) : (
          <button onClick={open} className={toolbarBtn}>edit</button>
        )}
      </div>

      {editing ? (
        <div>
          {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
          {/* text-base (16px) stops iOS zoom; spellcheck off so code/ticker names aren't underlined */}
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
      ) : (
        children
      )}
    </>
  )
}
