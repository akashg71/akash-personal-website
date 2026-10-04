'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { mutate } from './mutate'

export default function TaskItem({
  file,
  line,
  raw,
  title,
  initialChecked,
  label,
  children,
}: {
  file: string
  line: number
  raw: string
  title: string // plain text, for the delete confirmation
  initialChecked: boolean
  label: ReactNode
  children?: ReactNode
}) {
  const router = useRouter()
  const [checked, setChecked] = useState(initialChecked)
  const [pending, setPending] = useState(false)
  const [deleted, setDeleted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggle() {
    const next = !checked
    setChecked(next) // optimistic
    setError(null)
    setPending(true)
    mutate('/api/notes/toggle', { file, line, raw, checked: next })
      .catch(err => {
        setChecked(!next) // revert
        setError(err instanceof Error ? err.message : 'Save failed')
      })
      .finally(() => setPending(false))
  }

  function remove() {
    if (!window.confirm(`Delete “${title}”${children ? ' and the items under it' : ''}?`)) return
    setDeleted(true) // optimistic
    setError(null)
    mutate('/api/notes/delete', { file, kind: 'task', line, raw })
      .then(() => router.refresh()) // line numbers below this item shifted
      .catch(err => {
        setDeleted(false)
        setError(err instanceof Error ? err.message : 'Delete failed')
      })
  }

  if (deleted) return null

  return (
    <li className="list-none">
      <div className="flex items-start">
        <label className="flex flex-1 items-start gap-3 py-2 min-h-11 cursor-pointer select-none -ml-2 pl-2 rounded-md active:bg-stone-100">
          <input
            type="checkbox"
            checked={checked}
            onChange={toggle}
            disabled={pending}
            className="mt-[3px] size-5 shrink-0 accent-stone-800 cursor-pointer"
          />
          <span className={checked ? 'text-stone-400 line-through decoration-stone-300' : 'text-stone-800'}>
            {label}
          </span>
        </label>
        {/* Outside the <label> so tapping it can never toggle the checkbox. */}
        <button
          onClick={remove}
          disabled={pending}
          aria-label={`Delete ${title}`}
          className="size-11 shrink-0 -mr-3 flex items-center justify-center text-lg leading-none text-stone-300 hover:text-red-700 active:text-red-700"
        >
          ×
        </button>
      </div>
      {error && (
        <p role="alert" className="ml-8 -mt-1 mb-2 text-xs text-red-700">
          {error}
        </p>
      )}
      {children && <div className="ml-8">{children}</div>}
    </li>
  )
}
