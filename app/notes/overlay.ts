import { useEffect, useSyncExternalStore } from 'react'
import { isShown, type Overlay } from '@/lib/optimistic'
import { getSync, mutate, nextRefresh, requestRefresh, seqOf, subscribe } from './mutate'

// Optimistic changes by overlay key (lib/optimistic.ts). Module state rather
// than component state: a refresh caused by another write can remount the
// component that made the change, and the change must still show.
type Entry = Overlay & { id: number; value: string }
const EMPTY: Entry[] = []
const entries = new Map<string, Entry[]>()
const listeners = new Set<() => void>()
let nextId = 0

function update(key: string, edit: (list: Entry[]) => Entry[]) {
  const list = edit(entries.get(key) ?? EMPTY)
  if (list.length) entries.set(key, list)
  else entries.delete(key)
  listeners.forEach(f => f())
}

function subscribeEntries(f: () => void) {
  listeners.add(f)
  return () => void listeners.delete(f)
}

const getApplied = () => getSync().applied

/** The changes under `key` that the render of file version `sha` doesn't show yet. */
export function useOverlay(key: string, sha: string): { id: number; value: string }[] {
  const list = useSyncExternalStore(subscribeEntries, () => entries.get(key) ?? EMPTY, () => EMPTY)
  const applied = useSyncExternalStore(subscribe, getApplied, () => 0)
  const shown = list.filter(e => isShown(e, seqOf(sha), applied))
  const stale = shown.length < list.length
  // Forget what the page now shows, so it can't come back if the file later
  // returns to an older version (same sha).
  useEffect(() => {
    if (stale) update(key, l => l.filter(e => isShown(e, seqOf(sha), getApplied())))
  }, [stale, key, sha])
  return shown
}

/**
 * Show `value` under `key` straight away, queue the write, and re-render from
 * GitHub once it lands. On failure the change is withdrawn and the error is
 * rethrown for the caller to show.
 */
export function writeOptimistic(key: string, value: string, url: string, body: unknown) {
  const id = nextId++
  update(key, l => [...l, { id, value }])
  return mutate(url, body).then(
    data => {
      // No sha in the answer → rely on the refresh alone.
      update(key, l => l.map(e => (e.id === id ? { ...e, seq: data.seq ?? Infinity, needGen: nextRefresh() } : e)))
      requestRefresh()
      return data
    },
    err => {
      update(key, l => l.filter(e => e.id !== id))
      throw err
    },
  )
}
