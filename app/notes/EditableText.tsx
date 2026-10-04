'use client'

import { useRef, useState, type MouseEvent, type KeyboardEvent, type ReactNode } from 'react'
import { renameKey } from '@/lib/optimistic'
import { useOverlay, writeOptimistic } from './overlay'

/**
 * Rendered text that turns into a one-line input when tapped (task wording or a
 * section heading). Enter or tapping away saves; Escape cancels. The input holds
 * the markdown source, so **bold** / [links](…) survive an edit.
 * The new wording shows at once (as typed, until the server renders it); a
 * failed save brings back the old wording and reopens the input with the error.
 */
export default function EditableText({
  file,
  kind,
  line,
  raw,
  source,
  sha,
  className = '',
  children,
}: {
  file: string
  kind: 'task' | 'section'
  line: number
  raw: string
  source: string
  sha: string // file version this render shows
  className?: string
  children: ReactNode
}) {
  const key = renameKey(file, kind, raw)
  const renamed = useOverlay(key, sha).at(-1)?.value
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(source)
  const [error, setError] = useState<string | null>(null)
  const cancelled = useRef(false)
  // Enter commits, and then the blur that follows would commit again — with the
  // old `raw`, which the server can no longer find (409). One commit per edit.
  const committing = useRef(false)

  function start(e: MouseEvent | KeyboardEvent) {
    if ((e.target as HTMLElement).closest('a')) return // links inside the text still navigate
    if (renamed !== undefined) return // still saving: `raw` no longer matches the file
    setValue(source)
    setError(null)
    committing.current = false
    setEditing(true)
  }

  function commit() {
    if (committing.current) return
    const text = value.trim()
    if (!text || text === source.trim()) return setEditing(false)
    committing.current = true
    setError(null)
    setEditing(false)
    writeOptimistic(key, text, '/api/notes/rename', { file, kind, line, raw, text })
      .catch(err => {
        setValue(text) // reopen with what they typed, to retry or Escape
        setEditing(true)
        setError(err instanceof Error ? err.message : 'Save failed')
      })
      .finally(() => (committing.current = false))
  }

  if (editing) {
    return (
      <span className="block flex-1 min-w-0">
        {/* text-base keeps iOS from zooming; font inherits so a heading still looks like one */}
        <input
          autoFocus
          value={value}
          maxLength={300}
          enterKeyHint="done"
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commit() }
            if (e.key === 'Escape') { cancelled.current = true; setEditing(false) }
          }}
          onBlur={() => {
            if (cancelled.current) { cancelled.current = false; return }
            commit()
          }}
          className="w-full min-h-9 -my-1 -mx-2 px-2 text-base [font-weight:inherit] rounded border border-stone-300 bg-white text-stone-900 focus:outline-none focus:border-stone-500"
        />
        {error && <span role="alert" className="block mt-1 text-xs font-normal text-red-700">{error}</span>}
      </span>
    )
  }

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={start}
      onKeyDown={e => e.key === 'Enter' && start(e)}
      aria-busy={renamed !== undefined || undefined}
      className={`cursor-text ${className} ${renamed !== undefined ? 'text-stone-500' : ''}`}
    >
      {renamed ?? children}
    </span>
  )
}
