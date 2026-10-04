'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { mutate } from './mutate'

/** One-shot write (optionally confirmed), then re-render from GitHub. */
export default function ActionButton({
  url,
  body,
  confirmText,
  ariaLabel,
  className,
  children,
}: {
  url: string
  body: unknown
  confirmText?: string
  ariaLabel?: string
  className: string
  children: ReactNode
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function run() {
    if (confirmText && !window.confirm(confirmText)) return
    setPending(true)
    setError(null)
    mutate(url, body)
      .then(() => router.refresh())
      .catch(err => setError(err instanceof Error ? err.message : 'Save failed'))
      .finally(() => setPending(false))
  }

  return (
    <span className="inline-flex flex-col items-end">
      <button onClick={run} disabled={pending} aria-label={ariaLabel} className={className}>
        {pending ? '…' : children}
      </button>
      {error && <span role="alert" className="text-xs font-normal text-red-700">{error}</span>}
    </span>
  )
}
