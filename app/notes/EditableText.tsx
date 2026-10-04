'use client'

import { useRef, useState, type MouseEvent, type KeyboardEvent, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { mutate } from './mutate'

/**
 * Rendered text that turns into a one-line input when tapped (task wording or a
 * section heading). Enter or tapping away saves; Escape cancels. The input holds
 * the markdown source, so **bold** / [links](…) survive an edit.
 */
export default function EditableText({
  file,
  kind,
  line,
  raw,
  source,
  className = '',
  children,
}: {
  file: string
  kind: 'task' | 'section'
  line: number
  raw: string
  source: string
  className?: string
  children: ReactNode
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(source)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cancelled = useRef(false)
  // Enter commits, and then the blur that follows would commit again — with the
  // old `raw`, which the server can no longer find (409). One commit per edit.
  const committing = useRef(false)

  function start(e: MouseEvent | KeyboardEvent) {
    if ((e.target as HTMLElement).closest('a')) return // links inside the text still navigate
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
    setPending(true)
    setError(null)
    mutate('/api/notes/rename', { file, kind, line, raw, text })
      .then(() => {
        setEditing(false)
        router.refresh()
      })
      .catch(err => {
        committing.current = false // allow a retry from the still-open input
        setError(err instanceof Error ? err.message : 'Save failed')
      })
      .finally(() => setPending(false))
  }

  if (editing) {
    return (
      <span className="block flex-1 min-w-0">
        {/* text-base keeps iOS from zooming; font inherits so a heading still looks like one */}
        <input
          autoFocus
          value={value}
          readOnly={pending} // not `disabled`: disabling a focused input fires blur
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
          className="w-full min-h-9 -my-1 -mx-2 px-2 text-base [font-weight:inherit] rounded border border-stone-300 bg-white text-stone-900 focus:outline-none focus:border-stone-500 read-only:opacity-60"
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
      className={`cursor-text ${className}`}
    >
      {children}
    </span>
  )
}
