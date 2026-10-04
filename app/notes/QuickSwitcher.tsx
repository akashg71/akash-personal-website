'use client'

import { useEffect, useEffectEvent, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { noteHref, noteName, rankNotes } from '@/lib/paths'
import { mutate } from './mutate'
import ProgressBar from './ProgressBar'

/**
 * Obsidian-style quick switcher: ⌘K / Ctrl+K (or the button), type to filter,
 * ↑↓ + Enter to open. When nothing matches exactly, the last row offers to
 * create a note with that name ("Folder/Name" works).
 * Render several triggers if needed, but only one with `shortcut` — otherwise
 * ⌘K would open two overlays.
 */
export default function QuickSwitcher({
  notes,
  shortcut = false,
  className = '',
}: {
  notes: string[]
  shortcut?: boolean
  className?: string
}) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [navigating, startNavigation] = useTransition() // drives the progress bar
  const go = (href: string) => startNavigation(() => router.push(href))

  const results = useMemo(() => rankNotes(notes, query), [notes, query])
  const q = query.trim()
  const exact = results.some(p => noteName(p).toLowerCase() === q.toLowerCase() || p.toLowerCase() === `${q.toLowerCase()}.md`)
  const canCreate = q.length > 0 && !exact
  const rows = results.length + (canCreate ? 1 : 0)

  // Every open starts fresh: empty query, first row, no stale error.
  function show() {
    if (open) return
    setQuery('')
    setActive(0)
    setError(null)
    setOpen(true)
  }

  // An Effect Event, so the ⌘K listener always sees the current `open`.
  const toggle = useEffectEvent(() => (open ? setOpen(false) : show()))

  useEffect(() => {
    if (!shortcut) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shortcut])

  useEffect(() => {
    if (open) input.current?.focus()
  }, [open])

  // keep the highlighted row visible while arrowing through a long list
  useEffect(() => {
    list.current?.querySelector(`[data-row="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function choose(i: number) {
    if (i < results.length) {
      setOpen(false)
      go(noteHref(results[i]))
      return
    }
    if (!canCreate || pending) return
    setPending(true)
    setError(null)
    mutate('/api/notes/create', { kind: 'note', name: q })
      .then(data => {
        setOpen(false)
        if (data.href) go(data.href)
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Create failed'))
      .finally(() => setPending(false))
  }

  return (
    <>
      <ProgressBar active={navigating} />
      <button
        onClick={show}
        className={`flex items-center justify-between gap-2 h-11 px-3 rounded-md border border-stone-200 bg-white text-sm text-stone-500 hover:border-stone-300 ${className}`}
      >
        <span>⌕ search</span>
        {shortcut && <kbd className="text-[11px] text-stone-400 font-sans">⌘K</kbd>}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-stone-900/20 px-4 pt-[10vh]"
          onMouseDown={e => e.target === e.currentTarget && setOpen(false)}
        >
          <div role="dialog" aria-label="Open note" className="mx-auto max-w-lg rounded-lg bg-white shadow-xl border border-stone-200 overflow-hidden">
            {/* text-base (16px) stops iOS zooming */}
            <input
              ref={input}
              value={query}
              onChange={e => {
                setQuery(e.target.value)
                setActive(0) // a new query highlights the best match again
              }}
              onKeyDown={e => {
                if (e.key === 'Escape') setOpen(false)
                else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, rows - 1)) }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
                else if (e.key === 'Enter') { e.preventDefault(); if (rows) choose(active) }
              }}
              placeholder="Find or create a note…"
              enterKeyHint="go"
              className="w-full h-12 px-4 text-base border-b border-stone-200 focus:outline-none"
            />
            <ul ref={list} className="max-h-[60vh] overflow-y-auto py-1">
              {results.map((p, i) => {
                const folder = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''
                return (
                  <li key={p} data-row={i}>
                    <button
                      onMouseEnter={() => setActive(i)}
                      onClick={() => choose(i)}
                      className={`w-full flex items-center gap-2 min-h-11 px-4 text-left ${i === active ? 'bg-stone-100' : ''}`}
                    >
                      <span className="text-stone-900 truncate">{noteName(p)}</span>
                      {folder && <span className="text-xs text-stone-400 truncate">{folder}</span>}
                    </button>
                  </li>
                )
              })}
              {canCreate && (
                <li data-row={results.length}>
                  <button
                    onMouseEnter={() => setActive(results.length)}
                    onClick={() => choose(results.length)}
                    disabled={pending}
                    className={`w-full min-h-11 px-4 text-left text-stone-600 ${active === results.length ? 'bg-stone-100' : ''}`}
                  >
                    {pending ? 'creating…' : <>+ Create “<span className="text-stone-900">{q}</span>”</>}
                  </button>
                </li>
              )}
              {!rows && <li className="px-4 py-3 text-sm text-stone-400">No notes yet — type a name to create one.</li>}
            </ul>
            {error && <p role="alert" className="px-4 pb-3 text-xs text-red-700">{error}</p>}
          </div>
        </div>
      )}
    </>
  )
}
