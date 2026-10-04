// Shared setup for the flow files. run.mjs starts the app and the fake GitHub
// and passes their URLs in the environment; each flow file runs in its own
// process with one headless Chrome, and each flow gets a fresh repo and a
// fresh incognito context.
import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { after, test } from 'node:test'
import puppeteer from 'puppeteer-core'
import { fakeClient } from './client.mjs'

const { E2E_BASE_URL, E2E_FAKE_URL, E2E_PASSWORD } = process.env
if (!E2E_BASE_URL || !E2E_FAKE_URL || !E2E_PASSWORD) {
  throw new Error('Flow files need the app and fake GitHub that `npm run test:e2e` starts.')
}

export const BASE_URL = E2E_BASE_URL
export const PASSWORD = E2E_PASSWORD
export const fake = fakeClient(E2E_FAKE_URL)

export const encodePath = p => p.split('/').map(encodeURIComponent).join('/') // as lib/paths.ts
export const noteUrl = p => `${BASE_URL}/notes/${encodePath(p)}`
export const DESKTOP = { width: 1280, height: 900 }

const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

export function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  if (existsSync(MAC_CHROME)) return MAC_CHROME
  const names = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    for (const name of names) if (existsSync(join(dir, name))) return join(dir, name)
  }
  throw new Error('Chrome not found: set CHROME_PATH')
}

let browser
after(() => browser?.close())

async function getBrowser() {
  // CI runners (Ubuntu 24.04) block the user namespaces Chrome's sandbox needs.
  browser ??= await puppeteer.launch({ executablePath: chromePath(), headless: true, args: process.env.CI ? ['--no-sandbox'] : [] })
  return browser
}

// ── Guards ──────────────────────────────────────────────────

const pathOf = url => {
  try {
    return new URL(url).pathname
  } catch {
    return ''
  }
}

// Next aborts its own RSC/prefetch fetches when a navigation supersedes them.
const isNextFetch = req => {
  const h = req.headers()
  return req.url().includes('_rsc=') || 'rsc' in h || 'next-router-prefetch' in h
}

// Chrome asks for /favicon.ico when a page declares no icon. The site has none
// yet (handover C0.6), so that 404 is expected until an icon file exists; then
// this allowance switches itself off and a missing favicon fails again.
const ROOT = new URL('../../', import.meta.url)
const hasIcon = ['app/favicon.ico', 'public/favicon.ico'].some(f => existsSync(new URL(f, ROOT))) ||
  readdirSync(new URL('app/', ROOT)).some(f => /^(icon|apple-icon)\./.test(f))
const ALWAYS_ALLOWED = hasIcon ? [] : [[404, '/favicon.ico']]

/** Collects every failed request, unexpected status >= 400, console error and page error. */
function watch(page, flowAllow) {
  const problems = []
  let active = true
  const allow = [...ALWAYS_ALLOWED, ...flowAllow]
  const allowed = (status, url) => allow.some(([s, path]) => s === status && pathOf(url) === path)
  const add = msg => active && problems.push(msg)

  page.on('requestfailed', req => {
    const error = req.failure()?.errorText
    if (error === 'net::ERR_ABORTED' && isNextFetch(req)) return
    add(`request failed: ${req.method()} ${req.url()} (${error})`)
  })
  page.on('response', res => {
    if (res.status() >= 400 && !allowed(res.status(), res.url())) add(`HTTP ${res.status()}: ${res.request().method()} ${res.url()}`)
  })
  page.on('console', msg => {
    if (msg.type() !== 'error') return
    // Chrome also logs every allowed error status as "Failed to load resource".
    const status = Number(msg.text().match(/status of (\d{3})/)?.[1])
    if (status && allowed(status, msg.location()?.url ?? '')) return
    add(`console error: ${msg.text()}`)
  })
  page.on('pageerror', err => add(`page error: ${err?.message ?? err}`))
  const inflight = new Set()
  page.on('request', req => inflight.add(req))
  page.on('requestfinished', req => inflight.delete(req))
  page.on('requestfailed', req => inflight.delete(req))
  return { problems, inflight, stop: () => (active = false) }
}

/**
 * One browser test: the fake repo reset to `seed`, a fresh incognito context,
 * signed in unless `login: false`. Fails on any browser problem (see watch);
 * `allow` lists expected error responses as [status, '/path'] pairs.
 * fn(page, { dialogs }) — confirm() dialogs are accepted and their text recorded.
 */
export function flow(name, { seed = {}, allow = [], login: signIn = true, viewport = DESKTOP } = {}, fn) {
  test(name, async () => {
    await fake.reset(seed)
    const context = await (await getBrowser()).createBrowserContext()
    const page = await context.newPage()
    const watcher = watch(page, allow)
    const dialogs = []
    page.on('dialog', dialog => {
      dialogs.push(dialog.message())
      dialog.accept().catch(() => {})
    })
    try {
      await page.setViewport(viewport)
      page.setDefaultTimeout(10_000)
      if (signIn) await login(page)
      await fn(page, { dialogs })
      // Let trailing refreshes finish so their failures still count.
      await page.waitForNetworkIdle({ idleTime: 150, timeout: 5000 }).catch(() => {
        console.warn(`[e2e] network still busy after 5s: ${[...watcher.inflight].map(r => `${r.method()} ${r.url()}`).join(', ')}`)
      })
    } catch (err) {
      if (watcher.problems.length) err.message += `\n  browser problems:\n    ${watcher.problems.join('\n    ')}`
      throw err
    } finally {
      watcher.stop()
      await context.close()
    }
    assert.deepEqual(watcher.problems, [], 'browser reported problems')
  })
}

// ── Page helpers ────────────────────────────────────────────

export async function login(page) {
  await page.goto(`${BASE_URL}/notes`)
  await page.type('input[name=password]', PASSWORD)
  await Promise.all([page.waitForNavigation(), page.click('form[action="/api/notes/login"] button')])
  await hydrated(page)
}

/** Until React hydrates, clicks on client components do nothing; it tags hydrated nodes. */
export async function hydrated(page) {
  await page.waitForFunction(() => {
    const main = document.querySelector('main')
    return main && Object.keys(main).some(k => k.startsWith('__reactFiber$'))
  })
}

export async function open(page, path) {
  await page.goto(noteUrl(path))
  await hydrated(page)
}

/**
 * Wait for a visible match. `visible` also makes puppeteer poll every frame:
 * its default (a MutationObserver) misses text-only changes, like a button
 * going from "done" to "save", and would wait forever.
 */
export const waitFor = (page, selector) => page.waitForSelector(selector, { visible: true })

/** Click once the element is visible and enabled (it may arrive with a refresh). */
export async function click(page, selector) {
  const el = await waitFor(page, selector)
  await page.waitForFunction(node => !node.disabled, {}, el)
  await el.click()
}

/** Run `action` and wait for the app's answer to POST /api/notes/<route>. */
export async function api(page, route, action) {
  const [res] = await Promise.all([
    page.waitForResponse(r => r.request().method() === 'POST' && pathOf(r.url()) === `/api/notes/${route}`),
    action(),
  ])
  return { status: res.status(), body: await res.json().catch(() => null) }
}

/** Wait for a client-side navigation to land on `path` (a note path or '/notes'). */
export async function waitForNote(page, path) {
  const want = path === '/notes' ? path : `/notes/${encodePath(path)}`
  await page.waitForFunction(p => location.pathname === p, {}, want)
}

/** The text in the page's alert, if any (errors are role="alert"). */
export const alertText = page => page.$eval('[role=alert]', el => el.textContent).catch(() => null)

/** Newest commit message in the fake repo. */
export const lastCommit = async () => (await fake.state()).commits[0]?.message
