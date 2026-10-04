import assert from 'node:assert/strict'
import { BASE_URL, PASSWORD, click, flow, hydrated, waitFor } from '../harness.mjs'

const seed = { 'todo.md': '# Todo\n\n## Inbox\n\n- [ ] Buy milk\n' }
const session = async page => (await page.cookies()).find(c => c.name === 'notes_session')

async function submit(page, password) {
  await page.type('input[name=password]', password)
  await Promise.all([page.waitForNavigation(), click(page, 'form[action="/api/notes/login"] button')])
}

flow('login: wrong password is refused, the right one sets the session cookie', {
  seed,
  login: false,
  allow: [[401, '/api/notes/toggle']],
}, async page => {
  await page.goto(`${BASE_URL}/notes`)
  await waitFor(page, 'input[name=password]')
  const html = await page.content()
  for (const secret of ['fake-token', PASSWORD, 'test/notes']) assert.ok(!html.includes(secret), `login page leaks ${secret}`)
  const status = await page.evaluate(() => fetch('/api/notes/toggle', { method: 'POST', body: '{}' }).then(r => r.status))
  assert.equal(status, 401)

  await submit(page, 'not the password')
  assert.equal(new URL(page.url()).search, '?error=1')
  await waitFor(page, '[role=alert]::-p-text(Wrong password.)')
  assert.equal(await session(page), undefined)

  await submit(page, PASSWORD)
  assert.equal(new URL(page.url()).pathname, '/notes')
  await waitFor(page, 'input[type=checkbox][aria-label="Buy milk"]')
  const cookie = await session(page)
  assert.ok(cookie, 'no session cookie')
  assert.equal(cookie.httpOnly, true)
  assert.equal(cookie.secure, true)
  assert.equal(cookie.sameSite, 'Lax')
  assert.ok(Math.abs(cookie.expires * 1000 - Date.now() - 30 * 86_400_000) < 120_000, 'session should last 30 days')
})

flow('sign out clears the session', { seed }, async page => {
  await hydrated(page)
  await Promise.all([page.waitForNavigation(), click(page, 'aside form[action="/api/notes/logout"] button')])
  await waitFor(page, 'input[name=password]')
  assert.equal(await session(page), undefined)
})
