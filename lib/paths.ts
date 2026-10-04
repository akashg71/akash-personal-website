// Note-path helpers with no Node/server dependencies, so client components
// (quick switcher, today button) can use them. lib/notes.ts re-exports these.

export const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/')
export const noteHref = (p: string) => `/notes/${encodePath(p)}`
export const noteName = (p: string) => p.split('/').pop()!.replace(/\.md$/i, '')

export const JOURNAL_DIR = 'Journal'
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export const journalPath = (date: string) => `${JOURNAL_DIR}/${date}.md`

/**
 * Quick-switcher ranking. Exact name > name prefix > name substring > path
 * substring > every word somewhere in the path > in-order subsequence
 * ("clmech" → "Classical Mechanics"). Ties: shorter path, then alphabetical.
 */
export function rankNotes(paths: string[], query: string, limit = 50): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...paths].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).slice(0, limit)

  const words = q.split(/\s+/)
  const subsequence = (hay: string, needle: string) => {
    let i = 0
    for (const ch of hay) if (ch === needle[i]) i++
    return i === needle.length
  }
  const score = (p: string) => {
    const name = noteName(p).toLowerCase()
    const full = p.toLowerCase().replace(/\.md$/, '')
    if (name === q) return 100
    if (name.startsWith(q)) return 80
    if (name.includes(q)) return 60
    if (full.includes(q)) return 40
    if (words.length > 1 && words.every(w => full.includes(w))) return 30
    if (subsequence(full.replace(/[\s/_-]/g, ''), q.replace(/[\s/_-]/g, ''))) return 10
    return -1
  }
  return paths
    .map(p => ({ p, s: score(p) }))
    .filter(x => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.p.length - b.p.length || a.p.localeCompare(b.p))
    .slice(0, limit)
    .map(x => x.p)
}
