// Keyboard shortcuts on /notes. Which command a key press means is decided
// here, as pure functions, so the rules are unit-tested: never while typing,
// no stray modifiers, nothing mid-IME and nothing behind a dialog.
// app/notes/Shortcuts.tsx does the DOM side.

export type Command =
  | 'search'
  | 'today'
  | 'new-note'
  | 'edit'
  | 'save'
  | 'cancel'
  | 'next-task'
  | 'prev-task'
  | 'toggle-task'
  | 'edit-task'
  | 'help'

/** The KeyboardEvent fields the matcher reads. */
export type KeyPress = Pick<
  KeyboardEvent,
  'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'isComposing' | 'keyCode' | 'defaultPrevented'
>

export type KeyContext = {
  /** Focus is in a text field, in the note editor (rich or source), or in neither. */
  typing: 'field' | 'editor' | null
  /** Focus is on a task's checkbox, so Enter edits that task's text. */
  onTask: boolean
  /** A dialog is open and handles its own keys. */
  dialog: boolean
  /** Single-character shortcuts are on; the help dialog can switch them off. */
  singleKeys: boolean
}

/** Single-character shortcuts: never with ⌘, Ctrl or Alt, never while typing. */
export const SINGLE_KEYS = new Map<string, Command>([
  ['/', 'search'],
  ['t', 'today'],
  ['n', 'new-note'],
  ['e', 'edit'],
  ['j', 'next-task'],
  ['k', 'prev-task'],
  ['x', 'toggle-task'],
  ['?', 'help'],
])

// Shift is how '?' is typed everywhere, and '/' on some layouts (German: Shift+7).
const SHIFTED = new Set(['/', '?'])

export function matchShortcut(e: KeyPress, ctx: KeyContext): Command | null {
  // keyCode 229 is a key the IME is still composing; Safari sends it with isComposing false.
  if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return null
  if (e.metaKey || e.ctrlKey) {
    if (e.altKey || e.shiftKey) return null
    const key = e.key.toLowerCase()
    if (key === 's') return 'save' // from inside the editor too: that's where you save from
    return key === 'k' && !ctx.dialog ? 'search' : null
  }
  if (e.altKey || ctx.dialog) return null
  // Esc cancels the note editor even from inside it; any other field handles its own Esc.
  if (e.key === 'Escape') return e.shiftKey || ctx.typing === 'field' ? null : 'cancel'
  if (ctx.typing) return null
  if (e.key === 'Enter') return ctx.onTask && !e.shiftKey ? 'edit-task' : null
  if (!ctx.singleKeys || e.key.length !== 1) return null
  const key = e.key.toLowerCase() // Caps Lock still counts; Shift+letter is left free
  const command = SINGLE_KEYS.get(key)
  return command && (!e.shiftKey || SHIFTED.has(key)) ? command : null
}

/** Holding j or k walks the list; a held key acts once for everything else (a held x would flicker the tick). */
export const actsOnRepeat = (command: Command) => command === 'next-task' || command === 'prev-task'

/** j/k: the index to focus among `count` tasks from `current` (-1 = none yet). Stops at the ends. */
export function stepTask(current: number, count: number, dir: 1 | -1): number {
  if (count === 0) return -1
  if (current < 0) return dir > 0 ? 0 : count - 1
  return Math.min(Math.max(current + dir, 0), count - 1)
}

/** The element fields typingKind reads; plain objects in the unit tests. */
export type FocusTarget = {
  tagName: string
  type?: string
  isContentEditable?: boolean
  closest(selector: string): unknown
}

const NOT_TEXT = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'])

/** KeyContext.typing for the focused element. ProseMirror and CodeMirror are contenteditable. */
export function typingKind(el: FocusTarget | null): KeyContext['typing'] {
  if (!el?.tagName) return null
  const tag = el.tagName.toLowerCase()
  const text =
    el.isContentEditable ||
    tag === 'textarea' ||
    tag === 'select' ||
    (tag === 'input' && !NOT_TEXT.has((el.type ?? 'text').toLowerCase()))
  if (!text) return null
  return el.closest('[data-note-editor]') ? 'editor' : 'field'
}

const ARIA: Partial<Record<Command, string>> = {
  search: '/ Meta+K Control+K',
  today: 't',
  'new-note': 'n',
  edit: 'e',
  save: 'Meta+S Control+S',
  cancel: 'Escape',
}

/** Marks the control a command presses (Shortcuts.tsx finds it) and names its keys for screen readers. */
export const shortcutAttrs = (command: Command) => ({ 'data-shortcut': command, 'aria-keyshortcuts': ARIA[command] })

/** The help dialog's list. `mod` is ⌘ on Apple devices, Ctrl elsewhere. */
export const SHORTCUT_GROUPS: { title: string; rows: { key: string; label: string }[] }[] = [
  {
    title: 'Anywhere',
    rows: [
      { key: '/', label: 'Search or create a note' },
      { key: 'mod+K', label: 'Search, even while typing' },
      { key: 't', label: "Today's journal" },
      { key: 'n', label: 'New note' },
      { key: '?', label: 'These shortcuts' },
    ],
  },
  {
    title: 'Note',
    rows: [
      { key: 'e', label: 'Edit' },
      { key: 'mod+S', label: 'Save' },
      { key: 'Esc', label: 'Cancel editing, close a dialog' },
    ],
  },
  {
    title: 'Tasks',
    rows: [
      { key: 'j', label: 'Next task' },
      { key: 'k', label: 'Previous task' },
      { key: 'x', label: 'Tick or untick' },
      { key: 'Enter', label: 'Edit its text' },
    ],
  },
]

export const isApple = (platform: string) => /Mac|iPhone|iPad|iPod/i.test(platform)

export const keyLabel = (key: string, apple: boolean) => key.replace(/^mod\+/, apple ? '⌘' : 'Ctrl+')

/** localStorage key; 'off' switches single-key shortcuts off on this device (WCAG 2.1.4). */
export const SINGLE_KEYS_STORE = 'notes:shortcuts'

/** On unless switched off. `storage` is a getter: reading localStorage can itself throw. */
export function singleKeysOn(storage: () => Pick<Storage, 'getItem'>): boolean {
  try {
    return storage().getItem(SINGLE_KEYS_STORE) !== 'off'
  } catch {
    return true
  }
}
