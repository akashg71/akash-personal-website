// One write at a time across the whole page (ticks, quick-add, review). Parallel
// writes would all read the same sha and all but one would 409 — serializing
// avoids self-inflicted conflicts and keeps the server's single retry for real ones.
let chain: Promise<unknown> = Promise.resolve()

export type WriteResult = { href?: string; sha?: string; seq?: number }

// What the progress bar and the optimistic overlays read.
type Sync = { writes: number; refreshing: boolean; applied: number }
export const IDLE: Sync = { writes: 0, refreshing: false, applied: 0 }
let sync = IDLE
const listeners = new Set<() => void>()

function set(patch: Partial<Sync>) {
  sync = { ...sync, ...patch }
  listeners.forEach(f => f())
}

export function subscribe(f: () => void) {
  listeners.add(f)
  return () => void listeners.delete(f)
}
export const getSync = () => sync

// File shas our writes produced, numbered in write order: a render showing one
// of them includes that write and every earlier one.
let seq = 0
const shaSeq = new Map<string, number>()
export const seqOf = (sha: string) => shaSeq.get(sha) ?? 0

export function mutate(url: string, body: unknown): Promise<WriteResult> {
  set({ writes: sync.writes + 1 })
  const run = chain.then(async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error ?? `Save failed (${res.status})`)
    if (typeof data.sha === 'string') shaSeq.set(data.sha, (data.seq = ++seq))
    return data
  })
  chain = run.catch(() => {}).then(() => { // a failed write must not block the next one
    set({ writes: sync.writes - 1 })
    kick()
  })
  return run
}

// ── Refresh scheduler ───────────────────────────────────────
// Every re-render from GitHub goes through requestRefresh(). It waits until the
// write queue is idle and never overlaps another refresh: in Next 16 a refresh
// that overlaps another can leave the page stale. RefreshHost runs it.
let wanted = false
let started = 0
let runner: (() => void) | null = null

export function requestRefresh() {
  wanted = true
  kick()
}

/** The generation of the first refresh that starts from now on. */
export const nextRefresh = () => started + 1

export function setRefreshRunner(run: (() => void) | null) {
  runner = run
  kick()
}

function kick() {
  if (!wanted || !runner || sync.writes || sync.refreshing) return
  wanted = false
  const gen = ++started
  set({ refreshing: true })
  runner()
  // Safety net: never let a lost transition block refreshes for good.
  setTimeout(() => started === gen && refreshSettled(), 15_000)
}

export function refreshSettled() {
  if (!sync.refreshing) return
  set({ refreshing: false, applied: started })
  kick()
}

export function localDate() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
