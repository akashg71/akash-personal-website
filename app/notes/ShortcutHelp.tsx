'use client'

// Loaded only when the overlay first opens (next/dynamic in Shortcuts.tsx).
import { useEffect, useRef, useState } from 'react'
import { isApple, keyLabel, SHORTCUT_GROUPS, SINGLE_KEYS_STORE, singleKeysOn } from '@/lib/shortcuts'

/**
 * The "?" overlay: every shortcut, plus a switch for the single-key ones. A
 * native modal <dialog> traps focus, closes on Esc and gives focus back.
 */
export default function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [apple] = useState(() => isApple(navigator.platform || navigator.userAgent))
  const [singleKeys, setSingleKeys] = useState(() => singleKeysOn(() => localStorage))

  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal()
  }, [])

  function switchSingleKeys(on: boolean) {
    setSingleKeys(on)
    try {
      if (on) localStorage.removeItem(SINGLE_KEYS_STORE)
      else localStorage.setItem(SINGLE_KEYS_STORE, 'off')
    } catch {
      // storage blocked: the switch lasts until the page reloads
    }
  }

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      // A click on the backdrop lands on the <dialog> itself, outside the panel.
      onClick={e => e.target === e.currentTarget && e.currentTarget.close()}
      aria-labelledby="shortcuts-title"
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-lg border border-stone-200 bg-white text-stone-900 shadow-xl backdrop:bg-stone-900/20"
    >
      <div className="px-5 pt-3 pb-5">
        <div className="flex items-center justify-between">
          <h2 id="shortcuts-title" className="text-sm font-medium">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            aria-label="Close"
            className="size-9 -mr-2 flex items-center justify-center text-lg leading-none text-stone-400 hover:text-stone-900"
          >
            ×
          </button>
        </div>
        {SHORTCUT_GROUPS.map(group => (
          <section key={group.title} className="mt-3">
            <h3 className="text-xs font-medium uppercase tracking-wide text-stone-400">{group.title}</h3>
            <dl className="mt-1">
              {group.rows.map(row => (
                <div key={row.key} className="flex items-center justify-between gap-4 py-1 text-sm">
                  <dt className="text-stone-700">{row.label}</dt>
                  <dd>
                    <kbd className="inline-block min-w-6 rounded border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-center font-sans text-xs text-stone-600">
                      {keyLabel(row.key, apple)}
                    </kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <label className="mt-4 pt-4 border-t border-stone-200 flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={singleKeys}
            onChange={e => switchSingleKeys(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-stone-800"
          />
          <span className="text-sm text-stone-700">
            Single-key shortcuts
            <span className="block text-xs text-stone-400">
              Turn off if they get in the way, e.g. with speech input. {keyLabel('mod+K', apple)},{' '}
              {keyLabel('mod+S', apple)} and Esc keep working.
            </span>
          </span>
        </label>
      </div>
    </dialog>
  )
}
