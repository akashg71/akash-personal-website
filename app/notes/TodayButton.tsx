'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { journalPath, noteHref } from '@/lib/paths'
import { localDate, mutate } from './mutate'
import ProgressBar from './ProgressBar'

/**
 * Daily note (Logseq/Obsidian "journals"): opens Journal/<today>.md, creating it
 * from a template first if needed. "Today" is the device's local date, so a
 * late-evening tap in London doesn't land on tomorrow's UTC note.
 */
export default function TodayButton({ notes, className = '' }: { notes: string[]; className?: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [navigating, startNavigation] = useTransition() // drives the progress bar
  const go = (href: string) => startNavigation(() => router.push(href))

  function open() {
    const date = localDate()
    const path = journalPath(date)
    if (notes.includes(path)) return go(noteHref(path))
    setPending(true)
    setError(null)
    // The route is idempotent: if another device created it meanwhile, we still get its href.
    mutate('/api/notes/create', { kind: 'daily', date })
      .then(data => go(data.href ?? noteHref(path)))
      .catch(err => setError(err instanceof Error ? err.message : 'Could not open today'))
      .finally(() => setPending(false))
  }

  return (
    <span className={`flex flex-col ${className}`}>
      <ProgressBar active={navigating} />
      <button
        onClick={open}
        disabled={pending}
        className="h-11 px-3 rounded-md border border-stone-200 bg-white text-sm text-stone-600 hover:border-stone-300 disabled:opacity-50"
      >
        {pending ? '…' : 'today'}
      </button>
      {error && <span role="alert" className="mt-1 text-xs text-red-700">{error}</span>}
    </span>
  )
}
