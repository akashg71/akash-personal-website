// Optimistic writes on /notes: the change shows at once and stays until the
// server render includes it. Pure and client-safe, so server components can
// build the overlay keys and the rule can be unit tested.

/**
 * One optimistic change. `seq` and `needGen` are set when the write succeeds:
 * `seq` numbers the file sha the write produced (later writes get higher
 * numbers); `needGen` is the first refresh that started after it finished.
 */
export type Overlay = { seq?: number; needGen?: number }

/**
 * Show the change until the page renders a file sha at or after the write's
 * (`renderSeq`, 0 when unknown), or until a refresh that started after the
 * write has landed (covers a commit from another device on top).
 */
export function isShown(entry: Overlay, renderSeq: number, appliedGen: number): boolean {
  if (entry.seq === undefined || entry.needGen === undefined) return true // still saving
  return renderSeq < entry.seq && appliedGen < entry.needGen
}

// Where each kind of optimistic change is shown. Keyed by text, not line
// number, so they survive the line shifts an earlier write causes.
export const addKey = (file: string, headingRaw: string, n: number) => `${file}\0add\0${headingRaw}\0${n}`
export const sectionsKey = (file: string) => `${file}\0sections`
export const renameKey = (file: string, kind: 'task' | 'section', raw: string) => `${file}\0rename\0${kind}\0${raw}`
