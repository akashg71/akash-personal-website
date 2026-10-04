// The whole vault's markdown in memory, keyed by the HEAD commit. Every read
// checks HEAD with one conditional request (GitHub doesn't count an
// authenticated 304), so a warm page load costs no counted requests. Note text
// is cached by blob sha, so a new commit downloads only the notes it changed.
// Server-only.
import { createHash } from 'node:crypto'
import { imageType } from '../assets'
import { ghFetch } from './github'

export type Entry = { path: string; sha: string; size: number }
/** `assets`: the vault's images, by path and blob sha (never downloaded here). */
export type Snapshot = { commit: string; etag: string | null; notes: Entry[]; folders: string[]; assets: Entry[] }
export type TreeEntry = { path: string; mode: string; type: string; sha: string; size?: number }
export class SnapshotUnavailable extends Error {}

const BATCH_BLOBS = 100 // GraphQL charges one point per query, however many aliases
const BATCH_BYTES = 1_000_000 // keeps each GraphQL answer near 1 MB
const TEXT_LIMIT = 512_000 // GraphQL cuts Blob.text off here (isTruncated)
const RAW_LIMIT = 100 // one-request-per-note fetches allowed before giving up

type State = {
  snap: Snapshot | null
  blobs: Map<string, string> // blob sha → text: content-addressed, so never stale
  updated: Map<string, string> // `${sha} ${path}` → when that note last changed
  inflight: Promise<Snapshot> | null
  writes: number // a sync that started before a write must not overwrite it
}

// On globalThis, not in module variables: Next gives pages and route handlers
// separate instances of this module, and a write must update what pages read.
const KEY = Symbol.for('akashic.notes.snapshot')
const store = globalThis as unknown as Record<symbol, State | undefined>
const state: State = (store[KEY] ??= { snap: null, blobs: new Map(), updated: new Map(), inflight: null, writes: 0 })

/** Forget everything (tests). */
export function resetSnapshot() {
  Object.assign(state, { snap: null, inflight: null, writes: state.writes + 1 })
  state.blobs.clear()
  state.updated.clear()
}

const hidden = (path: string) => path.split('/').some(s => s.startsWith('.'))
const isNote = (path: string) => /\.md$/i.test(path) && !hidden(path)

const isAsset = (path: string) => imageType(path) !== null && !hidden(path)

/** The sha git gives `content` stored as a blob (text as UTF-8). */
export function gitBlobSha(content: string | Uint8Array) {
  const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : content
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
}

/**
 * Notes, folders and images in a recursive tree: no dot-paths, and symlinks
 * are neither. A folder is listed if it holds a note or a .gitkeep (made here
 * and still empty), so a folder of images alone, like attachments/, stays out
 * of the file tree.
 */
export function vaultEntries(tree: TreeEntry[]) {
  const files = tree.filter(e => e.type === 'blob' && e.mode !== '120000')
  const entry = (e: TreeEntry): Entry => ({ path: e.path, sha: e.sha, size: e.size ?? 0 })
  const shown = new Set<string>()
  for (const { path } of files) {
    if (!isNote(path) && !/(^|\/)\.gitkeep$/.test(path)) continue
    for (let i = path.indexOf('/'); i !== -1; i = path.indexOf('/', i + 1)) shown.add(path.slice(0, i))
  }
  return {
    notes: files.filter(e => isNote(e.path)).map(entry),
    folders: tree.filter(e => e.type === 'tree' && !hidden(e.path) && shown.has(e.path)).map(e => e.path),
    assets: files.filter(e => isAsset(e.path)).map(entry),
  }
}

/** GraphQL batches of at most 100 blobs and about 1 MB; blobs too big for GraphQL are left out. */
export function graphqlBatches(entries: Entry[]) {
  const batches: Entry[][] = []
  let bytes = 0
  for (const e of entries) {
    if (e.size >= TEXT_LIMIT) continue
    const last = batches.at(-1)
    if (last && last.length < BATCH_BLOBS && bytes + e.size <= BATCH_BYTES) {
      last.push(e)
      bytes += e.size
    } else {
      batches.push([e])
      bytes = e.size
    }
  }
  return batches
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  let next = 0
  const worker = async () => {
    while (next < items.length) await fn(items[next++])
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker))
}

type BlobNode = { text?: string | null; isTruncated?: boolean } | null

/** The text of each blob in `batch` (null where GraphQL didn't give it), or 'refused' on 401/403. */
async function graphqlTexts(batch: Entry[]): Promise<(string | null)[] | 'refused'> {
  const [owner, name] = (process.env.NOTES_REPO ?? '').split('/')
  const vars = batch.map((_, i) => `$o${i}:GitObjectID!`).join(',')
  const fields = batch.map((_, i) => `b${i}:object(oid:$o${i}){...on Blob{text isTruncated}}`).join(' ')
  const query = `query($owner:String!,$name:String!,${vars}){repository(owner:$owner,name:$name){${fields}}}`
  const variables = Object.fromEntries([['owner', owner], ['name', name], ...batch.map((e, i) => [`o${i}`, e.sha])])
  const res = await ghFetch('/graphql', { method: 'POST', body: JSON.stringify({ query, variables }) })
  if (res.status === 401 || res.status === 403) return 'refused'
  const json = res.ok ? ((await res.json()) as { data?: { repository?: Record<string, BlobNode> | null } }) : null
  return batch.map((_, i) => {
    const blob = json?.data?.repository?.[`b${i}`]
    return typeof blob?.text === 'string' && !blob.isTruncated ? blob.text : null
  })
}

/** Downloads `entries` into the blob cache: GraphQL batches first, one REST request each for the rest. */
async function fetchBlobs(entries: Entry[]) {
  const rest = entries.filter(e => e.size >= TEXT_LIMIT)
  let refused = false
  await pool(graphqlBatches(entries), 4, async batch => {
    const texts = refused ? 'refused' : await graphqlTexts(batch).catch(() => null)
    if (texts === 'refused') refused = true
    batch.forEach((e, i) => {
      const text = Array.isArray(texts) ? texts[i] : null
      // Only text that hashes to the blob: never serve a cut-off or re-encoded note.
      if (text !== null && gitBlobSha(text) === e.sha) state.blobs.set(e.sha, text)
      else rest.push(e)
    })
  })
  if (rest.length > RAW_LIMIT) throw new SnapshotUnavailable(`${rest.length} notes would need a request each`)
  await pool(rest, 6, async e => {
    const res = await ghFetch(`/git/blobs/${e.sha}`, { headers: { Accept: 'application/vnd.github.raw+json' } })
    if (!res.ok) throw new SnapshotUnavailable(`${e.path}: HTTP ${res.status}`)
    // Decoded like getNotesFile: Buffer keeps a BOM, TextDecoder would drop it.
    state.blobs.set(e.sha, Buffer.from(await res.arrayBuffer()).toString('utf8'))
  })
}

/** Stores a synced snapshot and drops what it no longer needs, unless a write landed meanwhile. */
function keep(writes: number, snap: Snapshot) {
  if (writes !== state.writes) return snap
  const live = new Set(snap.notes.map(e => e.sha))
  for (const sha of state.blobs.keys()) if (!live.has(sha)) state.blobs.delete(sha)
  for (const key of state.updated.keys()) if (!live.has(key.slice(0, 40))) state.updated.delete(key)
  return (state.snap = snap)
}

async function sync(): Promise<Snapshot> {
  const writes = state.writes
  const prev = state.snap
  const head = await ghFetch('/commits/HEAD', {
    headers: { Accept: 'application/vnd.github.sha', ...(prev?.etag ? { 'If-None-Match': prev.etag } : {}) },
  })
  if (head.status === 304 && prev) return prev
  if (head.status === 409) return keep(writes, { commit: '', etag: null, notes: [], folders: [], assets: [] }) // empty repo
  if (!head.ok) throw new SnapshotUnavailable(`HEAD: HTTP ${head.status}`)
  const commit = (await head.text()).trim()
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new SnapshotUnavailable('HEAD: not a commit sha')
  const etag = head.headers.get('etag')
  if (prev?.commit === commit) return keep(writes, { ...prev, etag })

  // By sha, not HEAD, so the tree is the commit's even if HEAD moves meanwhile.
  const res = await ghFetch(`/git/trees/${commit}?recursive=1`)
  if (!res.ok) throw new SnapshotUnavailable(`tree: HTTP ${res.status}`)
  const tree = (await res.json()) as { tree: TreeEntry[]; truncated?: boolean }
  if (tree.truncated) throw new SnapshotUnavailable('tree truncated')
  const { notes, folders, assets } = vaultEntries(tree.tree)
  await fetchBlobs(notes.filter(e => !state.blobs.has(e.sha)))
  return keep(writes, { commit, etag, notes, folders, assets })
}

/** The vault at HEAD: one conditional request when nothing changed. Concurrent callers share a sync. */
export function getSnapshot(): Promise<Snapshot> {
  if (!state.inflight) {
    const p: Promise<Snapshot> = sync().finally(() => {
      if (state.inflight === p) state.inflight = null
    })
    state.inflight = p
  }
  return state.inflight
}

let warned = false
function warnOnce(err: unknown) {
  if (warned) return
  warned = true
  console.warn(`notes: vault snapshot unavailable, reading file by file (${err instanceof Error ? err.message : err})`)
}

/** The snapshot if this server already holds one, else null: the caller reads file by file. */
export async function currentSnapshot(): Promise<Snapshot | null> {
  if (!state.snap) return null
  return getSnapshot().catch(err => (warnOnce(err), null))
}

/** Builds the snapshot in the background, e.g. once a cold page load has answered. */
export const warmSnapshot = () => getSnapshot().then(() => {}, warnOnce)

/** A note's text and blob sha from the snapshot; null if it doesn't hold it. */
export function readNote(snap: Snapshot, path: string) {
  const entry = snap.notes.find(e => e.path === path)
  const content = entry && state.blobs.get(entry.sha)
  return entry && content !== undefined ? { content, sha: entry.sha } : null
}

/**
 * When a note last changed, remembered per blob sha: only a new version of
 * the note asks GitHub again. (A note edited back to an older text keeps the
 * older date; fine for "updated 3d ago".)
 */
export async function lastUpdated(path: string, sha: string, load: () => Promise<string | null>) {
  const key = `${sha} ${path}`
  const known = state.updated.get(key)
  if (known) return known
  const date = await load()
  if (date) state.updated.set(key, date)
  return date
}

/** The fields used here of a Contents API PUT or DELETE answer. */
export type ContentsWrite = {
  content: { sha: string; size?: number } | null
  commit: { sha: string; parents: { sha: string }[]; committer?: { date?: string } }
}

/**
 * Our own commit through the Contents API: a note's text, an image's bytes,
 * or null for a delete. A note or image written on top of the snapshot's
 * commit is patched in, so the page refresh after a write is a free 304 that
 * already shows it. Anything else (a delete, a folder's .gitkeep, a parent we
 * haven't seen) only drops the etag: the next read lists the tree again but
 * downloads no blob it already has.
 */
export function applyWrite(path: string, content: string | Uint8Array | null, res: ContentsWrite) {
  state.writes++
  state.inflight = null // a sync already running predates this write
  // The write already happened: whatever GitHub answered, this must not throw.
  const sha = content !== null && res?.content && gitBlobSha(content) === res.content.sha ? res.content.sha : null
  const note = sha !== null && typeof content === 'string' && isNote(path)
  const asset = sha !== null && content instanceof Uint8Array && isAsset(path)
  const date = res?.commit?.committer?.date
  if (sha !== null && typeof content === 'string') {
    state.blobs.set(sha, content)
    if (date) state.updated.set(`${sha} ${path}`, date)
  }
  const snap = state.snap
  if (!snap) return
  if (!sha || !(note || asset) || !res.commit?.sha || res.commit.parents?.[0]?.sha !== snap.commit) {
    state.snap = { ...snap, etag: null }
    return
  }
  const entry = { path, sha, size: res.content?.size ?? (typeof content === 'string' ? Buffer.byteLength(content) : content!.length) }
  const upsert = (list: Entry[]) => (list.some(e => e.path === path) ? list.map(e => (e.path === path ? entry : e)) : [...list, entry])
  const folders = new Set(snap.folders)
  if (note) for (let i = path.indexOf('/'); i !== -1; i = path.indexOf('/', i + 1)) folders.add(path.slice(0, i))
  state.snap = {
    ...snap,
    commit: res.commit.sha,
    etag: `"${res.commit.sha}"`, // what commits/HEAD sends as its ETag
    notes: note ? upsert(snap.notes) : snap.notes,
    folders: [...folders],
    assets: asset ? upsert(snap.assets) : snap.assets,
  }
}
