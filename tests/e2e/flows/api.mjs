// Server-level checks, no browser: the auth gate on every write route, and
// that the app's GitHub calls reach the fake through the preload.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fakeClient } from '../client.mjs'
import { describeRoute, PROTECTED_ROUTES } from '../routes.mjs'

const { E2E_BASE_URL: BASE_URL, E2E_FAKE_URL, E2E_PASSWORD: PASSWORD } = process.env
const fake = fakeClient(E2E_FAKE_URL)

test('every API route but login and logout answers 401 without a valid session', async () => {
  await fake.reset({})
  assert.ok(PROTECTED_ROUTES.length >= 8, PROTECTED_ROUTES.map(describeRoute).join())
  for (const cookie of [null, `notes_session=${Date.now() + 60_000}.forged`]) {
    for (const route of PROTECTED_ROUTES) {
      const post = route.method === 'POST'
      const res = await fetch(`${BASE_URL}/api/notes/${route.path}`, {
        method: route.method,
        headers: { ...(post ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
        body: post ? '{}' : undefined,
      })
      assert.equal(res.status, 401, `${describeRoute(route)} with ${cookie ?? 'no cookie'}`)
    }
  }
  assert.deepEqual((await fake.requests()).requests, [], 'nothing should reach GitHub')
})

test('a signed-in page reads GitHub through the preload, from the fake', async () => {
  await fake.reset({ 'todo.md': '# Todo\n\n## Inbox\n\n- [ ] Buy milk\n' })
  const login = await fetch(`${BASE_URL}/api/notes/login`, {
    method: 'POST',
    body: new URLSearchParams({ password: PASSWORD }),
    redirect: 'manual',
  })
  const cookie = login.headers.getSetCookie().find(c => c.startsWith('notes_session='))?.split(';')[0]
  assert.ok(cookie, `no session cookie (status ${login.status})`)

  const page = await fetch(`${BASE_URL}/notes`, { headers: { cookie } })
  assert.ok((await page.text()).includes('Buy milk'))
  // Next's patched fetch called through to the preload, which tagged each call with its pid.
  // Which calls depends on the vault snapshot (cold, stale or current), so just that there were some.
  const { requests } = await fake.requests()
  assert.ok(requests.length > 0 && requests.every(r => r.pid && r.status < 400), JSON.stringify(requests))
})
