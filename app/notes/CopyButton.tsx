'use client'

import { useEffect, useState, type MouseEvent } from 'react'

type State = 'idle' | 'copied' | 'failed'
const LABEL: Record<State, string> = { idle: 'copy', copied: 'copied', failed: 'copy failed' }
const ANNOUNCE: Record<State, string> = { idle: '', copied: 'Code copied', failed: 'Copy failed' }

/**
 * Copies the code of the block it sits in. It reads the text from the page,
 * so the code isn't sent to the browser a second time as a prop. Always
 * visible, nothing on hover; the 44px target overhangs the slim header row.
 */
export default function CopyButton() {
  const [state, setState] = useState<State>('idle')

  useEffect(() => {
    if (state === 'idle') return
    const reset = setTimeout(() => setState('idle'), 2000)
    return () => clearTimeout(reset)
  }, [state])

  async function copy(e: MouseEvent<HTMLButtonElement>) {
    const code = e.currentTarget.closest('[data-code-block]')?.querySelector('code')
    if (code) setState((await copyText(code)) ? 'copied' : 'failed')
  }

  return (
    <>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy code"
        className="-my-1.5 h-11 min-w-11 shrink-0 px-3 text-xs text-stone-500 hover:text-stone-900 active:text-stone-900"
      >
        {LABEL[state]}
      </button>
      <span role="status" className="sr-only">
        {ANNOUNCE[state]}
      </span>
    </>
  )
}

async function copyText(node: HTMLElement) {
  try {
    await navigator.clipboard.writeText(node.textContent ?? '')
    return true
  } catch {
    // No async clipboard outside a secure context (the dev server on a LAN IP).
    return legacyCopy(node)
  }
}

function legacyCopy(node: HTMLElement) {
  const selection = window.getSelection()
  if (!selection) return false
  selection.selectAllChildren(node)
  const ok = document.execCommand('copy')
  selection.removeAllRanges()
  return ok
}
