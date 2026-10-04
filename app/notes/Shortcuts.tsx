'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { actsOnRepeat, matchShortcut, singleKeysOn, stepTask, typingKind, type Command } from '@/lib/shortcuts'

// Fetched the first time the overlay opens.
const ShortcutHelp = dynamic(() => import('./ShortcutHelp'), { ssr: false })

const HELP_EVENT = 'notes:shortcut-help'
const ROW = '[data-task-row]'
const BOX = 'input[type=checkbox]'

const shown = (el: Element) => el.getClientRects().length > 0

/**
 * The control a command presses, marked by shortcutAttrs. Search, today and
 * the tree exist twice (sidebar, phone row and drawer): use the one on screen,
 * else the one in the closed phone drawer, opening the drawer first.
 */
function control(command: Command) {
  const all = [...document.querySelectorAll<HTMLElement>(`[data-shortcut="${command}"]`)]
  const el = all.find(shown) ?? all.find(e => e.closest('details:not([open])'))
  el?.closest('details:not([open])')?.setAttribute('open', '')
  return el && shown(el) ? el : null
}

function press(command: Command) {
  const el = control(command)
  if (!el) return false
  if (el instanceof HTMLInputElement) el.focus() // the new-note box, already open
  else el.click()
  return true
}

/** Desktop keyboard shortcuts for the vault page (see SHORTCUT_GROUPS), and the "?" overlay. */
export default function ShortcutHost() {
  const [help, setHelp] = useState(false)

  useEffect(() => {
    // Where j/k left off, so they carry on after an edit re-renders the list and focus is lost.
    let last: { row: Element; index: number; path: string } | null = null
    const rows = () => [...document.querySelectorAll(ROW)].filter(shown)

    function remember(row: Element, list = rows()) {
      last = { row, index: list.indexOf(row), path: location.pathname }
    }

    function current(list: Element[], el: Element | null) {
      const row = el?.closest(ROW)
      if (row) return list.indexOf(row)
      if (!last || last.path !== location.pathname) return -1
      return list.includes(last.row) ? list.indexOf(last.row) : Math.min(last.index, list.length - 1)
    }

    function step(dir: 1 | -1, el: Element | null) {
      const list = rows()
      const row = list[stepTask(current(list, el), list.length, dir)]
      if (!row) return false
      row.querySelector<HTMLElement>(BOX)?.focus({ preventScroll: true })
      row.scrollIntoView({ block: 'nearest' })
      remember(row, list)
      return true
    }

    /** x ticks the focused task; Enter opens its text for editing. */
    function onRow(part: string, el: Element | null) {
      const row = el?.closest(ROW)
      const target = row?.querySelector<HTMLElement>(part)
      if (!row || !target) return false
      remember(row)
      target.click()
      return true
    }

    function run(command: Command, el: Element | null) {
      switch (command) {
        case 'help':
          setHelp(true)
          return true
        case 'next-task':
        case 'prev-task':
          return step(command === 'next-task' ? 1 : -1, el)
        case 'toggle-task':
          return onRow(BOX, el)
        case 'edit-task':
          return onRow('[role=button]', el)
        case 'cancel':
          if (press('cancel')) return true
          // Nothing to cancel: Esc drops the task focus ring instead.
          if (!(el instanceof HTMLElement) || !el.closest(ROW)) return false
          el.blur()
          last = null
          return true
        default:
          return press(command)
      }
    }

    const onKey = (e: KeyboardEvent) => {
      const el = e.target instanceof Element ? e.target : null
      const command = matchShortcut(e, {
        typing: typingKind(el),
        onTask: Boolean(el?.matches(`${ROW} ${BOX}`)),
        dialog: Boolean(document.querySelector('dialog[open], [role=dialog]')),
        singleKeys: singleKeysOn(() => localStorage),
      })
      if (!command) return
      if (e.repeat && !actsOnRepeat(command)) return e.preventDefault()
      if (run(command, el)) e.preventDefault()
    }
    const onHelp = () => setHelp(true)

    window.addEventListener('keydown', onKey)
    window.addEventListener(HELP_EVENT, onHelp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener(HELP_EVENT, onHelp)
    }
  }, [])

  return help ? <ShortcutHelp onClose={() => setHelp(false)} /> : null
}

/** The sidebar's "?" for mouse users. Touch screens never see shortcut hints. */
export function ShortcutsButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(HELP_EVENT))}
      aria-label="Keyboard shortcuts"
      aria-keyshortcuts="?"
      title="Keyboard shortcuts (?)"
      className="hidden pointer-fine:flex items-center justify-center size-7 rounded-full border border-stone-200 bg-white text-xs text-stone-400 hover:border-stone-300 hover:text-stone-900"
    >
      ?
    </button>
  )
}
