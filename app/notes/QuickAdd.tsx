'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { mutate } from './mutate'

export default function QuickAdd() {
  const router = useRouter()
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    setPending(true)
    setError(null)
    mutate('/api/notes/add', { text })
      .then(() => {
        setText('')
        router.refresh()
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Save failed'))
      .finally(() => setPending(false))
  }

  return (
    <form onSubmit={submit} className="mb-8">
      <div className="flex gap-2">
        {/* text-base (16px) stops iOS Safari zooming on focus */}
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          maxLength={300}
          placeholder="Add to inbox…"
          enterKeyHint="send"
          className="h-11 flex-1 min-w-0 px-3 text-base rounded-md border border-stone-300 bg-white focus:outline-none focus:border-stone-500"
        />
        <button
          disabled={pending || !text.trim()}
          className="h-11 px-4 rounded-md bg-stone-900 text-stone-50 text-sm font-medium active:bg-stone-700 disabled:opacity-40"
        >
          {pending ? '…' : 'add'}
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
    </form>
  )
}
