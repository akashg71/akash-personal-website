'use client'

import { useState } from 'react'
import { localDate, mutate, requestRefresh } from './mutate'

const DUE_AFTER_DAYS = 7

export default function ReviewBanner({ last, days }: { last: string | null; days: number | null }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const due = days === null || days >= DUE_AFTER_DAYS

  function markReviewed() {
    setPending(true)
    setError(null)
    mutate('/api/notes/review', { date: localDate() })
      .then(() => requestRefresh())
      .catch(err => setError(err instanceof Error ? err.message : 'Save failed'))
      .finally(() => setPending(false))
  }

  const status =
    last === null ? 'No weekly review recorded yet.' :
    days === 0 ? 'Reviewed today.' :
    `Last review ${days} day${days === 1 ? '' : 's'} ago (${last}).`

  return (
    <div
      className={
        due
          ? 'mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3'
          : 'mb-6 flex flex-wrap items-center justify-between gap-2'
      }
    >
      <p className={due ? 'text-sm text-amber-900' : 'text-xs text-stone-400'}>
        {due && <span className="font-medium">Weekly review due. </span>}
        {status}
      </p>
      <button
        onClick={markReviewed}
        disabled={pending}
        className={
          due
            ? 'h-11 px-4 rounded-md bg-stone-900 text-stone-50 text-sm font-medium active:bg-stone-700 disabled:opacity-50'
            : 'min-h-11 px-2 -mr-2 text-xs text-stone-400 underline underline-offset-2 hover:text-stone-900 disabled:opacity-50'
        }
      >
        {pending ? 'saving…' : 'mark reviewed'}
      </button>
      {error && <p role="alert" className="w-full text-xs text-red-700">{error}</p>}
    </div>
  )
}
