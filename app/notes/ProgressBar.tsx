/**
 * Thin bar along the top edge while something is in flight (a write, a
 * refresh, a navigation). Fixed, so showing it never shifts the layout.
 */
export default function ProgressBar({ active }: { active: boolean }) {
  if (!active) return null
  return <div data-progress aria-hidden className="fixed inset-x-0 top-0 z-50 h-0.5 bg-stone-800 animate-pulse" />
}
