// Code blocks in view mode: highlighted on the server with no Shiki in the
// client bundle, plain for an unknown or missing language, and a copy button
// on every block. Viewing never writes: the note's bytes stay as they were.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { BASE_URL, fake, flow, open, waitFor } from '../harness.mjs'

const TS = [
  'export function total(prices: number[]): number {',
  '  // A comment long enough to overflow a phone screen, which must scroll inside the block rather than widen the page.',
  "  return prices.reduce((sum, p) => sum + p, 0) // '<b>' & {braces} stay text",
  '}',
].join('\n')
const MERMAID = 'graph TD\n  A[Start] --> B{Done?}'
const PLAIN = 'no language here\n  indented line'
const NOTE = `# Code\n\n\`\`\`ts\n${TS}\n\`\`\`\n\nA diagram:\n\n\`\`\`mermaid\n${MERMAID}\n\`\`\`\n\n\`\`\`\n${PLAIN}\n\`\`\`\n`
const seed = { 'todo.md': '# Todo\n\n## Inbox\n', 'Code.md': NOTE }

const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }
const COPY = 'main button[aria-label="Copy code"]'

/** Each code block on the page: its <pre> classes, text, and token colours. */
const blocks = page => page.$$eval('main pre', pres => pres.map(pre => {
  const tokens = [...pre.querySelectorAll('code span span')]
  return {
    shiki: pre.classList.contains('shiki'),
    text: pre.querySelector('code').textContent,
    tokens: tokens.length,
    darkVars: tokens.filter(s => s.style.getPropertyValue('--shiki-dark')).length,
    colours: Object.fromEntries(tokens.map(s => [s.textContent.trim(), getComputedStyle(s).color])),
  }
}))

const clipboard = page => page.evaluate(() => navigator.clipboard.readText())

async function allowClipboard(page) {
  await page.browserContext().overridePermissions(BASE_URL, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write'])
}

/** Click (or tap) the nth copy button and wait for it to say "copied". */
async function copyBlock(page, n, how = 'click') {
  await waitFor(page, COPY)
  const button = (await page.$$(COPY))[n]
  await button[how]()
  await page.waitForFunction(b => b.textContent === 'copied', {}, button)
  return button
}

flow('a ts block is highlighted; unknown and missing languages stay plain', { seed }, async page => {
  await open(page, 'Code.md')
  await waitFor(page, 'main pre.shiki')
  const [ts, mermaid, plain] = await blocks(page)

  assert.equal(ts.shiki, true)
  assert.equal(ts.text, TS) // every character survives, including '<b>' & {braces}
  assert.ok(ts.tokens > 10, `only ${ts.tokens} tokens`)
  assert.equal(ts.darkVars, ts.tokens, 'every token carries its github-dark colour for a dark mode')
  assert.equal(ts.colours.export, 'rgb(215, 58, 73)') // github-light keyword red
  assert.equal(ts.colours.total, 'rgb(111, 66, 193)') // function name purple

  assert.deepEqual(mermaid, { shiki: false, text: MERMAID, tokens: 0, darkVars: 0, colours: {} })
  assert.deepEqual(plain, { shiki: false, text: PLAIN, tokens: 0, darkVars: 0, colours: {} })
  assert.equal(await page.$$eval(COPY, b => b.length), 3)

  assert.equal(await fake.read('Code.md'), NOTE)
  assert.deepEqual((await fake.state()).commits.map(c => c.message), ['seed'])
})

flow('highlighting costs no GitHub requests', { seed }, async page => {
  const load = async path => {
    await fake.clearRequests()
    await open(page, path)
    return (await fake.requests()).counts
  }
  // todo.md has no code: the note with three blocks must cost exactly the same.
  assert.deepEqual(await load('Code.md'), await load('todo.md'))
})

flow('copy puts the exact code on the clipboard and says so', { seed }, async page => {
  await allowClipboard(page)
  await open(page, 'Code.md')
  await waitFor(page, 'main pre.shiki')

  await copyBlock(page, 0)
  assert.equal(await clipboard(page), TS)
  assert.equal(await page.$eval('main [role=status]', el => el.textContent), 'Code copied')
  await copyBlock(page, 1)
  assert.equal(await clipboard(page), MERMAID)

  // Keyboard: the button comes just before its code in tab order; Enter copies.
  await page.focus('main pre:not(.shiki)')
  await page.keyboard.down('Shift')
  await page.keyboard.press('Tab')
  await page.keyboard.up('Shift')
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Copy code')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.activeElement?.textContent === 'copied')
  assert.equal(await clipboard(page), MERMAID)

  // The label goes back after a moment.
  const first = (await page.$$(COPY))[0]
  await page.waitForFunction(b => b.textContent === 'copy', { timeout: 5000 }, first)
  assert.equal(await fake.read('Code.md'), NOTE)
})

flow('phone: copy is a visible 44px target and long lines scroll inside the block', { seed, viewport: PHONE }, async page => {
  await allowClipboard(page)
  await open(page, 'Code.md')
  await waitFor(page, 'main pre.shiki')

  const sizes = await page.$$eval(COPY, els => els.map(el => {
    const r = el.getBoundingClientRect()
    const code = el.closest('[data-code-block]').querySelector('code').getBoundingClientRect()
    return {
      w: r.width,
      h: r.height,
      visible: el.checkVisibility({ opacityProperty: true, visibilityProperty: true }),
      clear: r.bottom <= code.top, // the target never covers the first line of code
    }
  }))
  assert.equal(sizes.length, 3)
  for (const s of sizes) assert.ok(s.w >= 44 && s.h >= 44 && s.visible && s.clear, JSON.stringify(s))

  const overflow = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth - window.innerWidth,
    block: document.querySelector('main pre.shiki').scrollWidth - document.querySelector('main pre.shiki').clientWidth,
  }))
  assert.equal(overflow.page, 0, 'the page must not scroll sideways')
  assert.ok(overflow.block > 0, 'the long line scrolls inside its block')

  await copyBlock(page, 0, 'tap')
  assert.equal(await clipboard(page), TS)
})

test('client chunks contain no Shiki code', () => {
  const root = new URL('../../../', import.meta.url)
  const read = path => readFileSync(new URL(path, root), 'utf8')
  // The control: the notes page's server trace does carry Shiki...
  const trace = JSON.parse(read('.next/server/app/notes/[[...path]]/page.js.nft.json')).files
  assert.ok(trace.some(f => f.endsWith('/node_modules/shiki/dist/core.mjs')), 'Shiki missing from the server trace')
  // ...and nothing the browser can download does.
  const needle = /shiki|codeToHast|createHighlighter|vscode-textmate|oniguruma|hast-util-to-jsx-runtime/i
  const files = readdirSync(new URL('.next/static/', root), { recursive: true }).filter(f => f.endsWith('.js'))
  assert.ok(files.length > 10, `only ${files.length} client chunks: wrong folder?`)
  assert.deepEqual(files.filter(f => needle.test(read(`.next/static/${f}`))), [])
})
