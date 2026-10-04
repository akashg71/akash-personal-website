// Server-only helpers for /notes. Never import from a 'use client' module —
// GITHUB_TOKEN / NOTES_PASSWORD have no NEXT_PUBLIC_ prefix so Next won't inline
// them into a client bundle, but the fetch helpers would still be dead weight there.
import { createHmac, createHash, timingSafeEqual } from 'node:crypto'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfm } from 'micromark-extension-gfm'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import type { Heading, ListItem, Nodes } from 'mdast'

export const TODO_FILE = 'todo.md' // the default note; gets the weekly review banner
export type NotesFile = string
export const SESSION_COOKIE = 'notes_session'
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30 // 30 days

// ── Vault paths ─────────────────────────────────────────────
// Any .md file in NOTES_REPO is a note; folders are directories. Paths are
// repo-relative ("Physics/Mechanics.md"). Validated on every request: the token
// is scoped to the repo, but a path is still never trusted.

const SEGMENT_RE = /^[\p{L}\p{N} _\-.,()'&+!]+$/u

function validSegments(path: string) {
  const segs = path.split('/')
  return (
    path.length <= 200 &&
    segs.every(s => SEGMENT_RE.test(s) && !s.startsWith('.') && s === s.trim())
  )
}

export function isNotePath(p: unknown): p is string {
  // Case-insensitive, matching listVault: a "Notes.MD" in the tree must also open.
  return typeof p === 'string' && /\.md$/i.test(p) && p.length > 3 && validSegments(p)
}

export function isFolderPath(p: unknown): p is string {
  return typeof p === 'string' && p.length > 0 && validSegments(p)
}

/** "Physics/ Mechanics " → "Physics/Mechanics.md"; null if not a valid name. */
export function toNotePath(input: string): string | null {
  const p = input.split('/').map(s => s.trim()).filter(Boolean).join('/')
  const withExt = p.toLowerCase().endsWith('.md') ? p : `${p}.md`
  return isNotePath(withExt) ? withExt : null
}

export { encodePath, noteHref, noteName, journalPath, ISO_DATE_RE } from './paths'
import { encodePath } from './paths'

// ── Config ──────────────────────────────────────────────────

export function notesConfig() {
  const token = process.env.GITHUB_TOKEN
  const repo = process.env.NOTES_REPO
  const password = process.env.NOTES_PASSWORD
  const missing = [
    !token && 'GITHUB_TOKEN',
    !repo && 'NOTES_REPO',
    !password && 'NOTES_PASSWORD',
  ].filter(Boolean) as string[]
  return { token: token ?? '', repo: repo ?? '', password: password ?? '', missing }
}

// ── Auth ────────────────────────────────────────────────────
// Stateless session: cookie = "<expiryMs>.<hmac(expiryMs)>", keyed by NOTES_PASSWORD.
// No session store needed, and rotating the password invalidates every device.
// CSRF: cookie is SameSite=Lax, so cross-site POSTs (fetch or form) don't carry it.

function sign(payload: string, key: string) {
  return createHmac('sha256', key).update(payload).digest('base64url')
}

function safeEqual(a: string, b: string) {
  // Hash first so lengths match — timingSafeEqual throws on unequal lengths.
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

export function checkPassword(input: string) {
  const { password } = notesConfig()
  return password.length > 0 && safeEqual(input, password)
}

export function createSessionToken() {
  const { password } = notesConfig()
  const exp = String(Date.now() + SESSION_MAX_AGE * 1000)
  return `${exp}.${sign(exp, password)}`
}

export function isValidSession(token: string | undefined) {
  const { password } = notesConfig()
  if (!token || !password) return false
  const [exp, sig] = token.split('.')
  if (!exp || !sig || Number(exp) < Date.now()) return false
  return safeEqual(sig, sign(exp, password))
}

// ── GitHub Contents API ─────────────────────────────────────

export class GitHubError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// GitHub reports when GITHUB_TOKEN expires on every response (no header = it
// never does). Kept from the latest one so /notes can warn before it lapses.
let tokenExpiration: string | null = null

/** The `github-authentication-token-expiration` header of GitHub's latest response. */
export const getTokenExpiration = () => tokenExpiration

async function gh(path: string, init: RequestInit = {}) {
  const { token, repo } = notesConfig()
  let res: Response
  try {
    res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError'
    throw new GitHubError(0, timedOut ? 'GitHub timed out after 10s' : 'GitHub unreachable (network error)')
  }
  tokenExpiration = res.headers.get('github-authentication-token-expiration')
  if (!res.ok) {
    const hint =
      res.status === 401 ? 'token invalid or expired' :
      res.status === 403 ? 'token lacks Contents permission on this repo' :
      res.status === 404 ? 'repo or file not found (check NOTES_REPO and that the token can see it)' :
      res.status === 409 ? 'sha conflict' :
      res.statusText
    throw new GitHubError(res.status, `GitHub ${res.status}: ${hint}`)
  }
  return res.json()
}

export async function getNotesFile(file: NotesFile) {
  // Default JSON media type returns base64 content *and* the blob sha we need for
  // the PUT. (The raw media type would skip the base64 but drops the sha.)
  const data = await gh(`/contents/${encodePath(file)}`)
  if (typeof data.content !== 'string') throw new GitHubError(404, `${file} is not a file`)
  return {
    content: Buffer.from(data.content, 'base64').toString('utf8'),
    sha: data.sha as string,
  }
}

export async function getLastUpdated(file: NotesFile): Promise<string | null> {
  // The Contents API has no timestamp — ask the commits endpoint for the latest
  // commit touching this path. Non-fatal: the page renders without it.
  try {
    const commits = await gh(`/commits?path=${encodeURIComponent(file)}&per_page=1`)
    return commits[0]?.commit?.committer?.date ?? null
  } catch {
    return null
  }
}

/**
 * Every note and folder in one call: the Git Trees API with recursive=1 (the
 * Contents API would need one request per directory). Dot-paths (.gitkeep,
 * .obsidian, .github) and non-markdown files are hidden.
 */
export async function listVault(): Promise<{ notes: string[]; folders: string[] }> {
  let data: { tree?: { path: string; type: string }[] }
  try {
    data = await gh('/git/trees/HEAD?recursive=1')
  } catch (err) {
    if (err instanceof GitHubError && (err.status === 409 || err.status === 404)) return { notes: [], folders: [] } // empty repo
    throw err
  }
  const visible = (p: string) => !p.split('/').some(s => s.startsWith('.'))
  const entries = (data.tree ?? []).filter(e => visible(e.path))
  return {
    notes: entries.filter(e => e.type === 'blob' && e.path.toLowerCase().endsWith('.md')).map(e => e.path),
    folders: entries.filter(e => e.type === 'tree').map(e => e.path),
  }
}

/** Delete a note. The Contents API needs the blob sha, so read it first. */
export async function deleteNoteFile(file: NotesFile): Promise<Response> {
  try {
    const { sha } = await getNotesFile(file)
    await gh(`/contents/${encodePath(file)}`, {
      method: 'DELETE',
      body: JSON.stringify({ message: `delete note: ${file}`, sha }),
    })
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json(
      { error: `Delete failed: ${err instanceof Error ? err.message : 'unknown error'}` },
      { status: err instanceof GitHubError && err.status === 404 ? 404 : 502 },
    )
  }
}

async function putNotesFile(file: NotesFile, content: string, sha: string, message: string) {
  // PUT with a stale sha → 409. That's our optimistic-concurrency check.
  return gh(`/contents/${encodePath(file)}`, {
    method: 'PUT',
    body: JSON.stringify({
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      sha,
    }),
  })
}

// ── Read-modify-write ───────────────────────────────────────

export type Edit =
  | { content: string; message: string }
  | { noop: true }              // already in the desired state
  | { conflict: string }        // can't apply against the current file

/**
 * Every write goes through here. The client never sends file content: each
 * attempt re-reads the file, applies `edit` to that fresh copy, and PUTs with
 * the sha it just read. A 409 means someone committed between our GET and PUT
 * (another device, or an edit on GitHub) — re-read and try once more; if it
 * conflicts again, report it rather than overwrite.
 */
export async function editNotesFile(file: NotesFile, edit: (content: string) => Edit): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { content, sha } = await getNotesFile(file)
      const result = edit(content)
      if ('noop' in result) return Response.json({ ok: true })
      if ('conflict' in result) return Response.json({ error: result.conflict }, { status: 409 })
      await putNotesFile(file, result.content, sha, result.message)
      return Response.json({ ok: true })
    } catch (err) {
      if (err instanceof GitHubError && err.status === 409 && attempt === 0) continue
      if (err instanceof GitHubError && err.status === 409) {
        return Response.json({ error: 'File kept changing while saving — reload and try again.' }, { status: 409 })
      }
      return Response.json(
        { error: `Save failed: ${err instanceof Error ? err.message : 'unknown error'}` },
        { status: 502 },
      )
    }
  }
  throw new Error('unreachable')
}

/**
 * Whole-file save from the source editor. Unlike editNotesFile there is no
 * retry: the client's text was based on `sha`, so a 409 means the file changed
 * under the editor and retrying would silently discard that change.
 */
export async function saveNotesFile(file: NotesFile, content: string, sha: string): Promise<Response> {
  try {
    await putNotesFile(file, content, sha, `edit: ${file}`)
    return Response.json({ ok: true })
  } catch (err) {
    if (err instanceof GitHubError && err.status === 409) {
      return Response.json(
        { error: `${file} changed since you opened the editor. Copy your text, reload, and re-apply.` },
        { status: 409 },
      )
    }
    return Response.json(
      { error: `Save failed: ${err instanceof Error ? err.message : 'unknown error'}` },
      { status: 502 },
    )
  }
}

/**
 * Create a missing file. PUT without a sha only succeeds if the path doesn't
 * exist yet; GitHub creates any intermediate folders implicitly. `extra` is
 * merged into the success JSON (e.g. the new note's href to navigate to).
 */
export async function createNotesFile(file: NotesFile, content: string, extra: object = {}): Promise<Response> {
  try {
    await gh(`/contents/${encodePath(file)}`, {
      method: 'PUT',
      body: JSON.stringify({ message: `create ${file}`, content: Buffer.from(content, 'utf8').toString('base64') }),
    })
    return Response.json({ ok: true, ...extra })
  } catch (err) {
    // GitHub answers 422 ("sha wasn't supplied") when the file already exists.
    if (err instanceof GitHubError && err.status === 422) {
      return Response.json({ error: `${file.replace(/\/\.gitkeep$/, '')} already exists.` }, { status: 409 })
    }
    return Response.json(
      { error: `Create failed: ${err instanceof Error ? err.message : 'unknown error'}` },
      { status: 502 },
    )
  }
}

// ── Markdown structure ──────────────────────────────────────

export function parseMarkdown(content: string) {
  return fromMarkdown(content, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
}

export const headingTitle = (line: string) => line.trim().replace(/^#{1,6}[ \t]*/, '').replace(/[ \t]+#+$/, '').trim()

// ── Line-level edits (pure; unit-tested) ────────────────────
// All edits split on \n only: CRLF files keep their \r on each line, and inserted
// lines copy the file's line ending so the file never ends up mixed.

const eolOf = (content: string) => (content.includes('\r\n') ? '\r' : '')

// Edits that add or remove lines assume every line ends in a newline. A file
// without a final one gets it for the edit and loses it again afterwards, so
// a CRLF file's new last line never keeps a lone \r or loses its \r\n.
function withFinalNewline(content: string, edit: (content: string) => string | null) {
  if (content === '' || content.endsWith('\n')) return edit(content)
  const end = `${eolOf(content)}\n`
  const out = edit(content + end)
  return out?.endsWith(end) ? out.slice(0, -end.length) : out
}

// Matches the task marker on a list-item line, including inside blockquotes:
// "  - [ ] foo", "> * [x] bar", "3. [ ] baz". Group 1 = prefix, group 2 = state.
const TASK_RE = /^((?:[ \t]*>)*[ \t]*(?:[-*+]|\d+[.)])[ \t]+)\[([ xX])\]/

// Line identity ignoring checkbox state, so a line ticked elsewhere still matches.
function normalize(line: string) {
  return line.replace(TASK_RE, '$1[?]').trimEnd()
}

// Item text for commit messages: marker and common inline markdown stripped,
// so the log reads "tick: Write phase 5 post — see plan", not raw syntax.
export function taskText(line: string) {
  return line
    .replace(TASK_RE, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|`)/g, '')
    .trim()
}

/** The markdown after the checkbox — what the inline editor shows. */
export function taskSource(line: string) {
  return line.replace(TASK_RE, '').trim()
}

export type PatchResult =
  | { kind: 'patched'; content: string; text: string }
  | { kind: 'noop' }        // already in the desired state (ticked on another device)
  | { kind: 'not-found' }   // line changed/removed upstream, or ambiguous

/**
 * The task item at `line` (1-based) whose source line is `raw`; if the line
 * moved (edited above on GitHub), the one task anywhere with that text.
 * Undefined if gone or ambiguous. Items come from the parse tree, so a
 * "- [ ]" line inside a fenced code block is text, never a task.
 */
function locateTask(content: string, lines: string[], line: number, raw: string) {
  const want = normalize(raw)
  const items: ListItem[] = []
  walk(parseMarkdown(content), n => {
    if (n.type === 'listItem' && typeof n.checked === 'boolean' && n.position) items.push(n)
  })
  const same = items.filter(n => normalize(lines[n.position!.start.line - 1] ?? '') === want)
  return same.find(n => n.position!.start.line === line) ?? (same.length === 1 ? same[0] : undefined)
}

/** 0-based index of the located task's checkbox line; -1 if gone/ambiguous. */
function locateTaskLine(content: string, lines: string[], line: number, raw: string) {
  const item = locateTask(content, lines, line, raw)
  const idx = item ? item.position!.start.line - 1 : -1
  return idx !== -1 && TASK_RE.test(lines[idx]) ? idx : -1
}

/** Replace a task's text, keeping its indent, bullet and checkbox state. null if gone/ambiguous. */
export function renameTask(content: string, line: number, raw: string, text: string): string | null {
  const lines = content.split('\n')
  const idx = locateTaskLine(content, lines, line, raw)
  if (idx === -1) return null
  const cr = lines[idx].endsWith('\r') ? '\r' : ''
  lines[idx] = `${lines[idx].match(TASK_RE)![0]} ${text}${cr}`
  return lines.join('\n')
}

/** Replace a section heading's text, keeping its level. null if gone/ambiguous. */
export function renameHeading(content: string, ref: HeadingRef, text: string): string | null {
  const found = locateHeading(content, ref)
  if (!found) return null
  const { kids, lines, hi } = found
  const k = kids[hi].position!.start.line - 1
  const cr = lines[k].endsWith('\r') ? '\r' : ''
  lines[k] = `${'#'.repeat((kids[hi] as Heading).depth)} ${text}${cr}`
  if (kids[hi].position!.end.line - 1 > k) lines.splice(k + 1, 1) // setext "===" underline: now ATX
  return lines.join('\n')
}

/**
 * Set the checkbox for one task to `checked`. `line` is 1-based; `raw` is that
 * source line as the client saw it. If the line moved (edited above on GitHub),
 * fall back to a unique match on the normalized text anywhere in the file.
 */
export function patchTask(content: string, line: number, raw: string, checked: boolean): PatchResult {
  const lines = content.split('\n')
  const idx = locateTaskLine(content, lines, line, raw)
  if (idx === -1) return { kind: 'not-found' }

  const current = lines[idx].match(TASK_RE)![2] !== ' '
  if (current === checked) return { kind: 'noop' }

  lines[idx] = lines[idx].replace(TASK_RE, `$1[${checked ? 'x' : ' '}]`)
  return { kind: 'patched', content: lines.join('\n'), text: taskText(lines[idx]) }
}

// Sections are top-level headings in the parsed tree; a section's own content is
// everything up to the next heading of *any* level. That's exactly where the
// page renders its "+ add item" control, so an add lands where the user tapped.
// Using the parse tree (not a line regex) means a "# comment" inside a fenced
// code block is never mistaken for a heading.

export type HeadingRef = { line: number; raw: string } // 1-based line + raw text, like tasks

function rootHeadings(content: string) {
  const kids = parseMarkdown(content).children
  return { kids, heads: kids.flatMap((n, i) => (n.type === 'heading' && n.position ? [i] : [])) }
}

function insertTask(content: string, kids: ReturnType<typeof rootHeadings>['kids'], hi: number, text: string) {
  const eol = eolOf(content)
  const lines = content.split('\n')
  let last = hi
  for (let i = hi + 1; i < kids.length && kids[i].type !== 'heading'; i++) last = i

  if (last === hi) {
    // Empty section: replace the blank run after the heading with blank / item [/ blank].
    const at = kids[hi].position!.end.line
    let j = at
    while (j < lines.length && lines[j].trim() === '') j++
    const body = [eol, `- [ ] ${text}${eol}`]
    if (j < lines.length) body.push(eol)  // separate from the next heading
    else if (j > at) body.push('')        // keep the file's trailing newline
    lines.splice(at, j - at, ...body)
    return lines.join('\n')
  }

  const node = kids[last]
  const at = node.position!.end.line
  if (node.type === 'list' && !node.ordered) {
    // Join the existing list, matching its indent and bullet character.
    const m = lines[node.position!.start.line - 1].match(/^([ \t]*)([-*+])/)
    lines.splice(at, 0, `${m?.[1] ?? ''}${m?.[2] ?? '-'} [ ] ${text}${eol}`)
  } else {
    lines.splice(at, 0, eol, `- [ ] ${text}${eol}`)
  }
  return lines.join('\n')
}

/** Index (into root children) of the heading at `ref`; unique-text fallback if it moved. */
function locateHeading(content: string, ref: HeadingRef) {
  const { kids, heads } = rootHeadings(content)
  const lines = content.split('\n')
  const raw = ref.raw.trimEnd()
  const lineOf = (i: number) => lines[kids[i].position!.start.line - 1].trimEnd()

  let hi = heads.find(i => kids[i].position!.start.line === ref.line && lineOf(i) === raw)
  if (hi === undefined) {
    const matches = heads.filter(i => lineOf(i) === raw)
    if (matches.length !== 1) return null
    hi = matches[0]
  }
  return { kids, heads, lines, hi }
}

/** Append "- [ ] text" to the section under `heading`. null if the heading is gone/ambiguous. */
export function addToSection(content: string, heading: HeadingRef, text: string): string | null {
  const found = locateHeading(content, heading)
  return found && insertTask(content, found.kids, found.hi, text)
}

/** Remove lines [start, end) (0-based) and tidy the seam so no blank-line pile-up is left behind. */
function removeLines(lines: string[], start: number, end: number) {
  lines.splice(start, end - start)
  if (start > 0 && start < lines.length && lines[start - 1].trim() === '' && lines[start].trim() === '') {
    // Drop the upper blank: the lower one may be the final '' that ends a CRLF file with \r\n.
    lines.splice(start - 1, 1)
  }
  while (lines.length > 1 && lines[lines.length - 1] === '' && lines[lines.length - 2].trim() === '') {
    lines.splice(lines.length - 2, 1) // at most one trailing newline
  }
  return lines.join('\n')
}

/**
 * Delete a section: its heading plus everything under it — including deeper
 * sub-sections — up to the next heading of the same or higher level.
 */
export function deleteSection(content: string, heading: HeadingRef): string | null {
  const found = locateHeading(content, heading)
  if (!found) return null
  const { kids, heads, lines, hi } = found
  const depth = (kids[hi] as Heading).depth
  const next = heads.find(i => i > hi && (kids[i] as Heading).depth <= depth)
  const end = next === undefined ? lines.length : kids[next].position!.start.line - 1
  return removeLines(lines, kids[hi].position!.start.line - 1, end)
}

function walk(node: Nodes, visit: (n: Nodes) => void) {
  visit(node)
  if ('children' in node) for (const c of node.children) walk(c as Nodes, visit)
}

/** Delete one task item, including anything nested under it. null if gone/ambiguous. */
export function deleteTask(content: string, line: number, raw: string): string | null {
  return withFinalNewline(content, c => {
    const lines = c.split('\n')
    const item = locateTask(c, lines, line, raw)
    return item ? removeLines(lines, item.position!.start.line - 1, item.position!.end.line) : null
  })
}

/** Add "## title" before the Inbox section (Inbox stays last), else at the end. null if it exists. */
export function addSection(content: string, title: string): string | null {
  const eol = eolOf(content)
  const { kids, heads } = rootHeadings(content)
  const lines = content.split('\n')
  const titles = heads.map(i => headingTitle(lines[kids[i].position!.start.line - 1]).toLowerCase())
  if (titles.includes(title.toLowerCase())) return null

  const heading = `## ${title}${eol}`
  const inbox = titles.indexOf('inbox')
  if (inbox === -1) {
    if (content.trim() === '') return `${heading}\n`
    return `${content.trimEnd()}${eol}\n${eol}\n${heading}\n`
  }
  const k = kids[heads[inbox]].position!.start.line - 1
  const block = [heading, eol]
  if (k > 0 && lines[k - 1].trim() !== '') block.unshift(eol)
  lines.splice(k, 0, ...block)
  return lines.join('\n')
}

// The review stamp is a plain, visible line so it stays editable on GitHub.
// /notes shows it as the banner instead of rendering it inline.
export const REVIEW_LINE_RE = /^Last reviewed:[ \t]*(\d{4}-\d{2}-\d{2})[ \t]*$/i

export function lastReviewed(content: string): string | null {
  for (const l of content.split('\n')) {
    const m = l.trimEnd().match(REVIEW_LINE_RE)
    if (m) return m[1]
  }
  return null
}

/** Set "Last reviewed: <date>", replacing the existing stamp or inserting one under the H1. */
export function stampReview(content: string, date: string): string | null {
  const eol = eolOf(content)
  const stamp = `Last reviewed: ${date}${eol}`
  const lines = content.split('\n')

  const existing = lines.findIndex(l => REVIEW_LINE_RE.test(l.trimEnd()))
  if (existing !== -1) {
    if (lines[existing].trimEnd().endsWith(date)) return null // already stamped today
    lines[existing] = stamp
    return lines.join('\n')
  }

  const h1 = lines.findIndex(l => /^#[ \t]/.test(l))
  if (h1 === -1) return `${stamp}\n${eol}\n${content}`
  const after = lines[h1 + 1]?.trim() === '' ? [eol, stamp] : [eol, stamp, eol]
  lines.splice(h1 + 1, 0, ...after)
  return lines.join('\n')
}
