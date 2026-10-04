'use client'

import { useOverlay } from './overlay'

// Placeholders for items and sections that are still being written, drawn
// where the server will insert them (Markdown.tsx places them). Not
// interactive: they have no line number yet, so nothing may address them.

/** `joinsList`: the section ends in a bullet list, which the new items will join. */
export function PendingItems({ overlayKey, sha, joinsList }: { overlayKey: string; sha: string; joinsList: boolean }) {
  const items = useOverlay(overlayKey, sha)
  if (!items.length) return null
  // Margins match where the items will land, so nothing moves when they do.
  return (
    <ul aria-label="Saving" className={joinsList ? '-mt-2 mb-2' : 'my-2'}>
      {items.map(item => (
        <li key={item.id} data-pending className="list-none flex items-start text-stone-500">
          <span className="size-11 shrink-0 -ml-3 flex items-center justify-center">
            <input type="checkbox" disabled aria-hidden className="size-5" />
          </span>
          <span className="flex-1 min-w-0 py-2.5 break-words">{item.value}</span>
        </li>
      ))}
    </ul>
  )
}

export function PendingSections({ overlayKey, sha }: { overlayKey: string; sha: string }) {
  const sections = useOverlay(overlayKey, sha)
  // Heading plus the space its "+ add item" will take, so nothing moves when it lands.
  return sections.map(s => (
    <div key={s.id} data-pending>
      <h3 className="text-lg font-semibold text-stone-500 mt-10 mb-2 pb-1 border-b border-stone-200">{s.value}</h3>
      <div className="mt-1 mb-2 min-h-11" />
    </div>
  ))
}
