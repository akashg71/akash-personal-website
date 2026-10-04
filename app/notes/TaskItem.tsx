'use client'

import { useState, type ReactNode } from 'react'
import { mutate, requestRefresh } from './mutate'
import EditableText from './EditableText'

export default function TaskItem({
  file,
  line,
  raw,
  title,
  source,
  initialChecked,
  label,
  children,
}: {
  file: string
  line: number
  raw: string
  title: string // plain text, for the delete confirmation
  source: string // markdown after the checkbox, for inline editing
  initialChecked: boolean
  label: ReactNode
  children?: ReactNode
}) {
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
      .then(() => requestRefresh()) // line numbers below this item shifted
      .catch(err => {
        setDeleted(false)
        setError(err instanceof Error ? err.message : 'Delete failed')
      })
  }

  if (deleted) return null

  return (
    <li className="list-none">
      <div className="flex items-start">
        {/* Only the checkbox ticks (44px target); tapping the text edits it. */}
        <label className="size-11 shrink-0 -ml-3 flex items-center justify-center cursor-pointer rounded-md active:bg-stone-100">
          <input
            type="checkbox"
            checked={checked}
            onChange={toggle}
            disabled={pending}
            aria-label={title}
            className="size-5 accent-stone-800 cursor-pointer"
          />
        </label>
        <div className="flex-1 min-w-0 py-2.5">
          <EditableText
            file={file}
            kind="task"
            line={line}
            raw={raw}
            source={source}
            className={checked ? 'text-stone-400 line-through decoration-stone-300' : 'text-stone-800'}
          >
            {label}
          </EditableText>
        </div>
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
