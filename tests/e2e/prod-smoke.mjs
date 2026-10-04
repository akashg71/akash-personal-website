// `npm run smoke:prod`: quick checks against production (BASE_URL, default
// https://akashestra.com).
//   Always, with no session: /notes serves the login form, every write route
//   answers 401, and the favicon status is reported.
//   Only if .env.local exists: the authenticated protocol from the handover —
//   sign in, write test data only under "Claude Test/", delete it, and check
//   todo.md and progress.md are byte-identical (same blob sha) before and after.
import { existsSync, readFileSync } from 'node:fs'
import { PROTECTED_ROUTES } from './routes.mjs'

const BASE_URL = (process.env.BASE_URL ?? 'https://akashestra.com').replace(/\/$/, '')
// Vercel's bot protection may answer 403 to unfamiliar clients, so look like desktop Chrome.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36'
const ENV_FILE = new URL('../../.env.local', import.meta.url)

let failed = 0
async function check(name, fn) {
  try {
    const note = await fn()
    console.log(`✓ ${name}${note ? ` — ${note}` : ''}`)
  } catch (err) {
    failed++
    console.log(`✗ ${name} — ${err.message}${err.cause ? ` (${err.cause.code ?? err.cause.message})` : ''}`)
  }
}

function expect(ok, message) {
  if (!ok) throw new Error(message)
}

const site = (path, init = {}) => fetch(`${BASE_URL}${path}`, { redirect: 'manual', ...init, headers: { 'user-agent': UA, ...init.headers } })
const post = (path, body, cookie) => site(path, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
  body: JSON.stringify(body),
})

/**
 * Retry once when the socket dies before any response: a reused keep-alive
 * connection is sometimes already closed. Only for requests that are safe to
 * repeat — refused before any write, or a delete.
 */
async function retrying(send) {
  try {
    return await send()
  } catch (err) {
    if (err.cause?.code !== 'UND_ERR_SOCKET') throw err
    return send()
  }
}

// ── Without a session ───────────────────────────────────────

console.log(`Smoke test against ${BASE_URL}\n`)

await check('GET /notes shows the login form', async () => {
  const res = await retrying(() => site('/notes'))
  const html = await res.text()
  expect(res.status === 200, `status ${res.status}`)
  expect(html.includes('name="password"') && html.includes('action="/api/notes/login"'), 'no login form in the page')
})

await check(`POST to each write route without a session → 401 (${PROTECTED_ROUTES.join(', ')})`, async () => {
  const wrong = []
  for (const route of PROTECTED_ROUTES) {
    const res = await retrying(() => post(`/api/notes/${route}`, {})).catch(err => ({ status: err.cause?.code ?? err.message }))
    await res.arrayBuffer?.() // an unread body pins its socket
    if (res.status !== 401) wrong.push(`${route}: ${res.status}`)
  }
  expect(!wrong.length, wrong.join(', '))
})

await check('GET /favicon.ico (reported, not enforced)', async () => `status ${(await retrying(() => site('/favicon.ico'))).status}`)

// ── Signed in (needs .env.local) ────────────────────────────

if (!existsSync(ENV_FILE)) {
  console.log('\n- signed-in checks skipped: no .env.local')
} else {
  await signedInChecks(readEnv(readFileSync(ENV_FILE, 'utf8')))
}

console.log(failed ? `\n✗ ${failed} check(s) failed` : '\n✓ all checks passed')
process.exit(failed ? 1 : 0)

function readEnv(text) {
  const env = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return env
}

async function signedInChecks({ GITHUB_TOKEN: token, NOTES_REPO: repo, NOTES_PASSWORD: password }) {
  if (!token || !repo || !password) return console.log('\n- signed-in checks skipped: .env.local lacks GITHUB_TOKEN, NOTES_REPO or NOTES_PASSWORD')
  console.log('\nSigned in:')

  const encode = p => p.split('/').map(encodeURIComponent).join('/')
  /** A file in the notes repo as { sha, text } — the blob sha is git's own checksum — or null. */
  async function getFile(path) {
    const res = await fetch(`https://api.github.com/repos/${repo}/contents/${encode(path)}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
      cache: 'no-store',
    })
    if (res.status === 404) return null
    expect(res.ok, `GitHub ${res.status} for ${path}`)
    const { sha, content } = await res.json()
    return { sha, text: Buffer.from(content, 'base64').toString('utf8') }
  }
  const blobSha = async path => (await getFile(path))?.sha ?? null

  const untouched = ['todo.md', 'progress.md']
  const before = await Promise.all(untouched.map(blobSha))
  const file = `Claude Test/smoke-${Date.now()}.md`
  let cookie = null
  let created = false

  try {
    await check('sign in with NOTES_PASSWORD', async () => {
      const res = await site('/api/notes/login', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ password }),
      })
      expect(res.status === 303 && !res.headers.get('location')?.includes('error'), `status ${res.status} → ${res.headers.get('location')}`)
      cookie = res.headers.getSetCookie().find(c => c.startsWith('notes_session='))?.split(';')[0]
      expect(cookie, 'no session cookie')
    })
    if (!cookie) return

    await check(`create, edit and tick ${file}`, async () => {
      const name = file.replace(/\.md$/, '')
      const step = async (route, body, label) => {
        const res = await post(`/api/notes/${route}`, body, cookie)
        expect(res.ok, `${label}: ${res.status} ${await res.text()}`)
      }
      await step('create', { kind: 'note', name }, 'create')
      created = true
      await step('section', { file, title: 'Smoke' }, 'section')
      await step('add', { file, text: 'smoke item', heading: { line: 3, raw: '## Smoke' } }, 'add')
      await step('toggle', { file, line: 5, raw: '- [ ] smoke item', checked: true }, 'toggle')
      const want = `# ${name.slice('Claude Test/'.length)}\n\n## Smoke\n\n- [x] smoke item\n`
      const got = (await getFile(file))?.text
      expect(got === want, `GitHub has ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`)
      const page = await site(`/notes/${encode(file)}`, { headers: { cookie } })
      expect(page.status === 200 && (await page.text()).includes('smoke item'), `note page: ${page.status}`)
    })
  } finally {
    if (created) {
      await check(`delete ${file}`, async () => {
        const res = await retrying(() => post('/api/notes/delete', { file, kind: 'note' }, cookie))
        expect(res.ok || res.status === 404, `${res.status} ${await res.text()}`) // 404: a first try landed
        expect((await blobSha(file)) === null, 'still on GitHub')
      })
    }
    await check(`${untouched.join(' and ')} unchanged`, async () => {
      const after = await Promise.all(untouched.map(blobSha))
      expect(after.every((sha, i) => sha === before[i]), `before ${before.join(', ')} / after ${after.join(', ')}`)
    })
  }
}
