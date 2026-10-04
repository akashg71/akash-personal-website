// In-memory GitHub for the e2e suite. Serves the REST endpoints lib/notes.ts
// calls (contents GET/PUT/DELETE, git/trees, commits) over plain HTTP, with
// real git blob/tree/commit shas so the sha checks behave like the real thing.
// Test files run in other processes and drive it through the /__fake/* control
// API (see `control` below); tests/e2e/client.mjs wraps that API.
//
// New endpoint: add a row to `routes` — [method, pattern, name, handler].
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'

export const FAKE_TOKEN = 'fake-token'
export const FAKE_REPO = 'test/notes'
const DOCS = 'https://docs.github.com/rest'

// ── Git objects ─────────────────────────────────────────────

const gitSha = (type, body) => createHash('sha1').update(`${type} ${body.length}\0`).update(body).digest('hex')

// git sorts tree entries by name, comparing a directory as if it ended in "/".
const sortKey = e => Buffer.from(e.type === 'tree' ? `${e.name}/` : e.name)

/** Every directory implied by the file paths, with real git tree shas. */
function buildTrees(files) {
  const dirs = new Map([['', []]]) // dir path → [{ name, path, type }]
  const dirOf = path => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
  const ensure = dir => {
    if (dirs.has(dir)) return dirs.get(dir)
    dirs.set(dir, [])
    ensure(dirOf(dir)).push({ name: dir.slice(dir.lastIndexOf('/') + 1), path: dir, type: 'tree' })
    return dirs.get(dir)
  }
  for (const path of files.keys()) ensure(dirOf(path)).push({ name: path.slice(path.lastIndexOf('/') + 1), path, type: 'blob' })

  const shas = new Map()
  const hash = dir => {
    const entries = dirs.get(dir).sort((a, b) => Buffer.compare(sortKey(a), sortKey(b)))
    const body = Buffer.concat(entries.flatMap(e => [
      Buffer.from(`${e.type === 'tree' ? '40000' : '100644'} ${e.name}\0`),
      Buffer.from(e.type === 'tree' ? hash(e.path) : files.get(e.path).sha, 'hex'),
    ]))
    shas.set(dir, gitSha('tree', body))
    return shas.get(dir)
  }
  hash('')
  return { dirs, shas }
}

class Repo {
  files = new Map() // path → { bytes, sha }
  commits = [] // oldest first: { sha, tree, parent, message, date, paths }

  get head() {
    return this.commits.at(-1) ?? null
  }

  isDir(path) {
    return [...this.files.keys()].some(p => p.startsWith(`${path}/`))
  }

  /** Apply [path, Buffer | null] changes (null deletes) as one commit. */
  commit(changes, message) {
    for (const [path, bytes] of changes) {
      if (bytes === null) this.files.delete(path)
      else this.files.set(path, { bytes, sha: gitSha('blob', bytes) })
    }
    const parent = this.head
    const tree = buildTrees(this.files).shas.get('')
    const who = `Fake GitHub <fake@example.com> ${Math.floor(Date.now() / 1000)} +0000`
    const body = `tree ${tree}\n${parent ? `parent ${parent.sha}\n` : ''}author ${who}\ncommitter ${who}\n\n${message}\n`
    const date = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
    const commit = { sha: gitSha('commit', Buffer.from(body)), tree, parent: parent?.sha ?? null, message, date, paths: changes.map(c => c[0]) }
    this.commits.push(commit)
    return commit
  }
}

// ── JSON shapes (the fields GitHub returns that a client could rely on) ──

const STATUS_TEXT = { 401: 'Bad credentials', 404: 'Not Found', 409: 'Conflict', 422: 'Validation Failed', 500: 'Server Error' }
const fail = (status, message = STATUS_TEXT[status] ?? 'Error') => ({ status, body: { message, documentation_url: DOCS, status: String(status) } })
const ok = (body, status = 200) => ({ status, body })

// GitHub wraps base64 content at 60 characters, each line ending in "\n".
const wrap64 = bytes => (bytes.length ? `${bytes.toString('base64').match(/.{1,60}/g).join('\n')}\n` : '')

function fileJson(path, file, withContent) {
  return {
    type: 'file', name: path.slice(path.lastIndexOf('/') + 1), path, sha: file.sha, size: file.bytes.length,
    ...(withContent ? { encoding: 'base64', content: wrap64(file.bytes) } : {}),
  }
}

function commitJson(c) {
  const person = { name: 'Fake GitHub', email: 'fake@example.com', date: c.date }
  return {
    sha: c.sha, author: person, committer: person, message: c.message,
    tree: { sha: c.tree }, parents: c.parent ? [{ sha: c.parent }] : [],
  }
}

// ── REST endpoints ──────────────────────────────────────────

function getContents({ repo, path }) {
  const file = repo.files.get(path)
  if (file) return ok(fileJson(path, file, true))
  if (path !== '' && !repo.isDir(path)) return fail(404)
  const entries = buildTrees(repo.files).dirs.get(path) ?? []
  if (!entries.length) return fail(404, path ? 'Not Found' : 'This repository is empty.')
  return ok(entries.map(e => (e.type === 'blob' ? fileJson(e.path, repo.files.get(e.path), false) : { type: 'dir', name: e.name, path: e.path })))
}

function putContents({ repo, path, body }) {
  if (!path || repo.isDir(path)) return fail(422, 'Invalid request.\n\n"path" is a directory.')
  if (typeof body?.message !== 'string' || !body.message) return fail(422, 'Invalid request.\n\n"message" wasn\'t supplied.')
  if (typeof body.content !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.content.replace(/\s/g, ''))) {
    return fail(422, 'Invalid request.\n\n"content" is not valid Base64.')
  }
  const current = repo.files.get(path)
  if (current && !body.sha) return fail(422, 'Invalid request.\n\n"sha" wasn\'t supplied.')
  if (body.sha && body.sha !== current?.sha) return fail(409, `${path} does not match ${body.sha}`)
  const commit = repo.commit([[path, Buffer.from(body.content, 'base64')]], body.message)
  return ok({ content: fileJson(path, repo.files.get(path), false), commit: commitJson(commit) }, current ? 200 : 201)
}

function deleteContents({ repo, path, body }) {
  const current = repo.files.get(path)
  if (!current) return fail(404)
  if (!body?.sha) return fail(422, 'Invalid request.\n\n"sha" wasn\'t supplied.')
  if (typeof body.message !== 'string' || !body.message) return fail(422, 'Invalid request.\n\n"message" wasn\'t supplied.')
  if (body.sha !== current.sha) return fail(409, `${path} does not match ${body.sha}`)
  return ok({ content: null, commit: commitJson(repo.commit([[path, null]], body.message)) })
}

function getTree({ repo, params: [ref], query }) {
  const head = repo.head
  if (!head) return fail(409, 'Git Repository is empty.')
  const { dirs, shas } = buildTrees(repo.files)
  const root = ['HEAD', 'main', head.sha].includes(ref) ? '' : [...shas].find(([, sha]) => sha === ref)?.[0]
  if (root === undefined) return fail(404)

  const tree = []
  const strip = p => (root ? p.slice(root.length + 1) : p)
  const walk = dir => {
    for (const e of dirs.get(dir)) {
      const blob = e.type === 'blob' && repo.files.get(e.path)
      tree.push(blob
        ? { path: strip(e.path), mode: '100644', type: 'blob', sha: blob.sha, size: blob.bytes.length }
        : { path: strip(e.path), mode: '040000', type: 'tree', sha: shas.get(e.path) })
      // GitHub treats any value of `recursive` (even "0") as "yes".
      if (e.type === 'tree' && query.has('recursive')) walk(e.path)
    }
  }
  walk(root)
  return ok({ sha: shas.get(root), tree, truncated: false })
}

function listCommits({ repo, query }) {
  if (!repo.head) return fail(409, 'Git Repository is empty.')
  const path = query.get('path')
  const perPage = Math.min(Math.max(Number(query.get('per_page')) || 30, 1), 100)
  const page = Math.max(Number(query.get('page')) || 1, 1)
  const touches = c => !path || c.paths.some(p => p === path || p.startsWith(`${path}/`))
  const list = repo.commits.filter(touches).reverse().slice((page - 1) * perPage, page * perPage)
  return ok(list.map(c => {
    const { sha, parents, ...commit } = commitJson(c)
    return { sha, commit, parents }
  }))
}

const REPO = String.raw`^\/repos\/([^/]+)\/([^/]+)`
const CONTENTS = new RegExp(`${REPO}\\/contents(?:\\/(.*))?$`)
const routes = [
  ['GET', CONTENTS, 'contents.get', getContents],
  ['PUT', CONTENTS, 'contents.put', putContents],
  ['DELETE', CONTENTS, 'contents.delete', deleteContents],
  ['GET', new RegExp(`${REPO}\\/git\\/trees\\/([^/]+)$`), 'git.trees.get', getTree],
  ['GET', new RegExp(`${REPO}\\/commits$`), 'commits.list', listCommits],
]

// ── Server ──────────────────────────────────────────────────

function decodePath(raw) {
  try {
    return raw.split('/').map(decodeURIComponent).join('/')
  } catch {
    return null // malformed %-escape
  }
}

function matchRoute(method, pathname) {
  for (const [m, re, name, fn] of routes) {
    const match = m === method && pathname.match(re)
    if (match) return { name, fn, params: match.slice(1) }
  }
  return null
}

const utf8 = content => (content === null ? null : Buffer.from(content, 'utf8'))

export class FakeGitHub {
  repo = new Repo()
  requests = []
  faults = []
  tokenExpiration = '2099-01-01 00:00:00 UTC'
  served = 0 // whole run, unlike `requests` which reset() clears
  pids = new Set()

  constructor({ repo = FAKE_REPO, token = FAKE_TOKEN } = {}) {
    this.repoName = repo
    this.token = token
  }

  /** Replace the whole repo with `files` ({ path: text }) in one commit; clears log and faults. */
  reset(files = {}) {
    this.repo = new Repo()
    this.requests = []
    this.faults = []
    const changes = Object.entries(files).map(([p, text]) => [p, utf8(text)])
    if (changes.length) this.repo.commit(changes, 'seed')
  }

  /** A commit from "another device": { path: text | null }. */
  write(files, message = 'edit from another device') {
    return this.repo.commit(Object.entries(files).map(([p, text]) => [p, utf8(text)]), message)
  }

  /**
   * Faults fire on the next `times` (default 1) requests matching method/route/path:
   *   status   → answer with that error status and leave the repo alone
   *   write    → first commit this text (null deletes) to `path`, then handle the
   *              request normally — e.g. a stale-sha 409 for the PUT after a GET
   *   delayMs  → wait before answering
   */
  takeFault(method, route, path) {
    const i = this.faults.findIndex(f =>
      (!f.method || f.method === method) && (!f.route || f.route === route) && (f.path === undefined || f.path === path))
    if (i === -1) return null
    const fault = this.faults[i]
    if (--fault.times <= 0) this.faults.splice(i, 1)
    return fault
  }

  async api(req, url, raw) {
    const found = matchRoute(req.method, url.pathname)
    if (!found) return { route: null, path: null, ...fail(404) }
    const [owner, name, ...params] = found.params
    const contents = found.name.startsWith('contents.')
    const path = contents ? decodePath(params[0] ?? '') : null
    const entry = { route: found.name, path }

    // Like GitHub: anonymous requests can't see a private repo (404); a wrong token is a 401.
    const auth = req.headers.authorization
    if (!auth) return { ...entry, ...fail(404) }
    if (auth !== `Bearer ${this.token}` && auth !== `token ${this.token}`) return { ...entry, ...fail(401) }
    if (`${owner}/${name}` !== this.repoName || (contents && path === null)) return { ...entry, ...fail(404) }

    let body = null
    if (raw.length) {
      try {
        body = JSON.parse(raw)
      } catch {
        return { ...entry, ...fail(400, 'Problems parsing JSON') }
      }
    }
    const fault = this.takeFault(req.method, found.name, path)
    if (fault?.delayMs) await new Promise(r => setTimeout(r, fault.delayMs))
    if (fault && 'write' in fault) this.write({ [fault.path]: fault.write })
    if (fault?.status) return { ...entry, ...fail(fault.status, fault.message) }
    return { ...entry, ...found.fn({ repo: this.repo, path, params, query: url.searchParams, body }) }
  }

  async handle(req, res) {
    const url = new URL(req.url, 'http://fake.local')
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString('utf8')

    if (url.pathname.startsWith('/__fake/')) {
      const handler = control[`${req.method} ${url.pathname.slice('/__fake'.length)}`]
      const result = handler ? handler(this, raw ? JSON.parse(raw) : {}, url.searchParams) : { status: 404, body: { error: 'no such control route' } }
      return send(res, result.status ?? 200, result.body ?? result)
    }

    const result = await this.api(req, url, raw)
    const pid = Number(req.headers['x-e2e-pid']) || null
    // Never log the Authorization header: a misconfigured run could carry a real token.
    this.requests.push({
      seq: this.requests.length + 1, method: req.method, route: result.route, path: result.path,
      url: url.pathname + url.search, status: result.status, pid,
    })
    if (pid) this.pids.add(pid)
    const used = ++this.served
    send(res, result.status, result.body, {
      'x-github-api-version-selected': '2022-11-28',
      'x-ratelimit-limit': '5000', 'x-ratelimit-used': String(used), 'x-ratelimit-remaining': String(Math.max(0, 5000 - used)),
      ...(this.tokenExpiration ? { 'github-authentication-token-expiration': this.tokenExpiration } : {}),
    })
  }

  listen(port = 0) {
    this.server = createServer((req, res) => {
      this.handle(req, res).catch(err => send(res, 500, { message: `fake GitHub crashed: ${err.stack ?? err}` }))
    })
    return new Promise(resolve => {
      this.server.listen(port, '127.0.0.1', () => {
        this.url = `http://127.0.0.1:${this.server.address().port}`
        resolve(this.url)
      })
    })
  }

  close() {
    return new Promise(resolve => (this.server ? this.server.close(() => resolve()) : resolve()))
  }
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers })
  res.end(JSON.stringify(body))
}

function counts(requests) {
  const out = {}
  for (const r of requests) out[r.route ?? 'unknown'] = (out[r.route ?? 'unknown'] ?? 0) + 1
  return out
}

// ── Control API (/__fake/*), used by tests/e2e/client.mjs ──

const control = {
  'POST /reset': (fake, body) => (fake.reset(body.files), { ok: true }),
  'POST /write': (fake, body) => ({ sha: fake.write(body.files, body.message).sha }),
  'GET /file': (fake, _, query) => {
    const file = fake.repo.files.get(query.get('path'))
    return file ? { content: file.bytes.toString('utf8'), sha: file.sha } : { status: 404, body: { error: 'no such file' } }
  },
  'GET /state': fake => ({
    head: fake.repo.head?.sha ?? null,
    paths: [...fake.repo.files.keys()].sort(),
    commits: fake.repo.commits.map(c => ({ sha: c.sha, message: c.message, paths: c.paths })).reverse(),
  }),
  'GET /requests': fake => ({ requests: fake.requests, counts: counts(fake.requests) }),
  'DELETE /requests': fake => ((fake.requests = []), { ok: true }),
  'POST /faults': (fake, body) => {
    if ('write' in body && typeof body.path !== 'string') return { status: 400, body: { error: 'a write fault needs a path' } }
    fake.faults.push({ times: 1, ...body })
    return { ok: true }
  },
  'GET /faults': fake => ({ faults: fake.faults }),
  'DELETE /faults': fake => ((fake.faults = []), { ok: true }),
  'POST /config': (fake, body) => {
    if ('tokenExpiration' in body) fake.tokenExpiration = body.tokenExpiration
    return { ok: true }
  },
}
