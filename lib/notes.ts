// Server-only helpers for /notes. Never import from a 'use client' module —
// GITHUB_TOKEN / NOTES_PASSWORD have no NEXT_PUBLIC_ prefix so Next won't inline
// them into a client bundle, but the fetch helpers would still be dead weight there.
import { createHmac, createHash, timingSafeEqual } from 'node:crypto'

export const NOTES_FILE = 'todo.md'
export const SESSION_COOKIE = 'notes_session'
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30 // 30 days

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

export async function getNotesFile() {
  // Default JSON media type returns base64 content *and* the blob sha we need for
  // the PUT. (The raw media type would skip the base64 but drops the sha.)
  const data = await gh(`/contents/${NOTES_FILE}`)
  return {
    content: Buffer.from(data.content, 'base64').toString('utf8'),
    sha: data.sha as string,
  }
}

export async function getLastUpdated(): Promise<string | null> {
  // The Contents API has no timestamp — ask the commits endpoint for the latest
  // commit touching this path. Non-fatal: the page renders without it.
  try {
    const commits = await gh(`/commits?path=${NOTES_FILE}&per_page=1`)
    return commits[0]?.commit?.committer?.date ?? null
  } catch {
    return null
  }
}

export async function putNotesFile(content: string, sha: string, message: string) {
  // PUT with a stale sha → 409. That's our optimistic-concurrency check.
  return gh(`/contents/${NOTES_FILE}`, {
    method: 'PUT',
    body: JSON.stringify({
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      sha,
    }),
  })
}

// ── Line patching ───────────────────────────────────────────
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

export type PatchResult =
  | { kind: 'patched'; content: string; text: string }
  | { kind: 'noop' }        // already in the desired state (ticked on another device)
  | { kind: 'not-found' }   // line changed/removed upstream, or ambiguous

/**
 * Set the checkbox for one task to `checked`. `line` is 1-based; `raw` is that
 * source line as the client saw it. If the line moved (edited above on GitHub),
 * fall back to a unique match on the normalized text anywhere in the file.
 */
export function patchTask(content: string, line: number, raw: string, checked: boolean): PatchResult {
  // Split on \n only: CRLF files keep their \r on each line and round-trip intact.
  const lines = content.split('\n')
  const want = normalize(raw)

  let idx = line - 1
  if (!(lines[idx] !== undefined && TASK_RE.test(lines[idx]) && normalize(lines[idx]) === want)) {
    const matches = lines.flatMap((l, i) => (TASK_RE.test(l) && normalize(l) === want ? [i] : []))
    if (matches.length !== 1) return { kind: 'not-found' }
    idx = matches[0]
  }

  const current = lines[idx].match(TASK_RE)![2] !== ' '
  if (current === checked) return { kind: 'noop' }

  lines[idx] = lines[idx].replace(TASK_RE, `$1[${checked ? 'x' : ' '}]`)
  return { kind: 'patched', content: lines.join('\n'), text: taskText(lines[idx]) }
}
