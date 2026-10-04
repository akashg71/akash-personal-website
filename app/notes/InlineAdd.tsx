'use client'

import { useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { mutate, requestRefresh } from './mutate'

/**
 * Collapsed "+ label" button that opens a one-line input. Used for "+ add item"
 * under each section and "+ new section" at the bottom. `body` is merged with
 * { [field]: value } and POSTed to `url`.
 */
export default function InlineAdd({
  trigger,
  placeholder,
  url,
  body,
  field,
  keepOpen = false,
  prefix = '',
}: {
  trigger: string
  placeholder: string
  url: string
  body: Record<string, unknown>
  field: 'text' | 'title' | 'name'
  keepOpen?: boolean
  prefix?: string // pre-filled text, e.g. the current folder "Physics/"
}) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(prefix)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function close() {
    setOpen(false)
    setValue(prefix)
    setError(null)
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!value.trim() || pending) return
    setPending(true)
    setError(null)
    mutate(url, { ...body, [field]: value })
      .then(data => {
        setValue(prefix)
        if (keepOpen) input.current?.focus() // rapid entry: type, enter, type, enter
        else setOpen(false)
        if (data.href) router.push(data.href) // e.g. open the note just created
        else requestRefresh()
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Save failed'))
      .finally(() => setPending(false))
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="min-h-11 -mx-2 px-2 text-sm text-stone-400 hover:text-stone-800 rounded-md active:bg-stone-100"
      >
        + {trigger}
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="my-1">
      <div className="flex gap-2">
        {/* text-base (16px) stops iOS Safari zooming on focus */}
        <input
          ref={input}
          autoFocus
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => e.key === 'Escape' && close()}
          placeholder={placeholder}
          maxLength={field === 'text' ? 300 : 200}
          enterKeyHint={keepOpen ? 'next' : 'done'}
          className="h-11 flex-1 min-w-0 px-3 text-base rounded-md border border-stone-300 bg-white focus:outline-none focus:border-stone-500"
        />
        <button
          disabled={pending || !value.trim()}
          className="h-11 px-4 rounded-md bg-stone-900 text-stone-50 text-sm font-medium active:bg-stone-700 disabled:opacity-40"
        >
          {pending ? '…' : 'add'}
        </button>
        <button type="button" onClick={close} className="h-11 px-2 text-sm text-stone-400 hover:text-stone-800">
          done
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
    </form>
  )
}
