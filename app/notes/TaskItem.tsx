'use client'

import { useState, type ReactNode } from 'react'
import { mutate } from './mutate'

export default function TaskItem({
  file,
  line,
  raw,
  initialChecked,
  label,
  children,
}: {
  file: string
  line: number
  raw: string
  initialChecked: boolean
  label: ReactNode
  children?: ReactNode
}) {
  const [checked, setChecked] = useState(initialChecked)
  const [pending, setPending] = useState(false)
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

  return (
    <li className="list-none">
      <label className="flex items-start gap-3 py-2 min-h-11 cursor-pointer select-none -mx-2 px-2 rounded-md active:bg-stone-100">
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
      {error && (
        <p role="alert" className="ml-8 -mt-1 mb-2 text-xs text-red-700">
          {error}
        </p>
      )}
      {children && <div className="ml-8">{children}</div>}
    </li>
  )
}
