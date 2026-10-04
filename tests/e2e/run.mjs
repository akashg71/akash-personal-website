// `npm run test:e2e`: production build → secrets check → fake GitHub + `next start`
// on free ports → every flow file in tests/e2e/flows → teardown (also on failure
// and Ctrl-C). Exits non-zero if any step fails.
//   E2E_SKIP_BUILD=1          reuse the existing .next build
//   E2E_VERBOSE=1             stream the `next start` log
//   CHROME_PATH=…             Chrome binary (default: macOS install, then PATH)
//   npm run test:e2e -- tasks editor   only flow files whose name contains one of these
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { FakeGitHub, FAKE_REPO, FAKE_TOKEN } from './fake-github.mjs'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const NEXT = join(ROOT, 'node_modules/next/dist/bin/next')
const FLOWS = join(ROOT, 'tests/e2e/flows')
const PRELOAD = pathToFileURL(join(ROOT, 'tests/e2e/preload.mjs')).href
const PASSWORD = randomBytes(18).toString('base64url')
const APP_ENV = { GITHUB_TOKEN: FAKE_TOKEN, NOTES_REPO: FAKE_REPO, NOTES_PASSWORD: PASSWORD, NEXT_TELEMETRY_DISABLED: '1' }

const children = new Set()
const serverLog = []
let fake

async function step(name, fn, passed = () => true) {
  const t = Date.now()
  console.log(`\n▸ ${name}`)
  const result = await fn()
  console.log(`${passed(result) ? '✓' : '✗'} ${name} (${((Date.now() - t) / 1000).toFixed(1)}s)`)
  return result
}

function run(args, { env = {}, allowFail = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } })
    children.add(child)
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      children.delete(child)
      if (code === 0 || allowFail) resolve(code ?? 1)
      else reject(new Error(`${args.slice(0, 2).join(' ')} exited with ${code ?? signal}`))
    })
  })
}

async function build() {
  // `next build` rewrites next-env.d.ts (dev → prod type paths); keep the tree clean.
  const envFile = join(ROOT, 'next-env.d.ts')
  const before = readFileSync(envFile, 'utf8')
  try {
    // Built with the fake secrets set, as Vercel builds with the real ones,
    // so the secrets check below would catch a value inlined into the bundle.
    await run([NEXT, 'build'], { env: APP_ENV })
  } finally {
    if (readFileSync(envFile, 'utf8') !== before) writeFileSync(envFile, before)
  }
}

/**
 * Invariant 5: no secret (or its env var name) in anything served to the
 * browser. Nor the yaml package, which only the server needs: its error class
 * name is a string literal, so it survives minification.
 */
function checkSecrets() {
  const needles = [FAKE_TOKEN, PASSWORD, 'GITHUB_TOKEN', 'NOTES_PASSWORD', 'NOTES_REPO', 'YAMLParseError']
  const files = readdirSync(join(ROOT, '.next/static'), { recursive: true, withFileTypes: true })
    .filter(f => f.isFile())
    .map(f => join(f.parentPath, f.name))
  const leaks = files.flatMap(file => {
    const bytes = readFileSync(file)
    return needles.filter(n => bytes.includes(n)).map(n => `${file.slice(ROOT.length)} contains ${n === PASSWORD ? 'the password' : n}`)
  })
  if (leaks.length) throw new Error(`secrets or server-only code in the client bundle:\n  ${leaks.join('\n  ')}`)
  console.log(`  ${files.length} files in .next/static, none contain the token, password, env var names or the yaml package`)
}

// localhost, not 127.0.0.1: route handlers see request.url as http://localhost:<port>
// under `next start`, so the login redirect would otherwise switch origin (and cookies).
const HOST = 'localhost'

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer().on('error', reject)
    probe.listen(0, HOST, () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

async function startNext(port, fakeUrl, baseUrl) {
  const child = spawn(process.execPath, [NEXT, 'start', '-p', String(port), '-H', HOST], {
    cwd: ROOT,
    detached: true, // own process group, so teardown can kill anything it spawns
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ...APP_ENV,
      FAKE_GITHUB_URL: fakeUrl,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${PRELOAD}`.trim(),
    },
  })
  child.detached = true
  children.add(child)
  let exited = null
  child.on('exit', code => {
    exited = code
    children.delete(child)
  })
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8')
    stream.on('data', chunk => {
      serverLog.push(...chunk.split('\n').filter(Boolean))
      if (process.env.E2E_VERBOSE) process.stdout.write(chunk.replace(/^/gm, '  [next] '))
    })
  }

  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (exited !== null) throw new Error(`next start exited (${exited}):\n${serverLog.join('\n')}`)
    const up = await fetch(`${baseUrl}/notes`).then(r => r.ok, () => false)
    // Never run flows unless the preload is in: without it the app would call real GitHub.
    if (up && serverLog.some(l => l.startsWith('[e2e preload]'))) return child
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error(`next start not ready after 30s:\n${serverLog.join('\n')}`)
}

function runFlows(baseUrl, fakeUrl) {
  const only = process.argv.slice(2)
  const files = readdirSync(FLOWS)
    .filter(f => f.endsWith('.mjs') && (!only.length || only.some(o => f.includes(o))))
    .sort()
  if (!files.length) throw new Error(`no flow files match ${only.join(', ')}`)
  // One file at a time: every flow resets the same fake repo.
  return run(
    ['--test', '--test-concurrency=1', '--test-timeout=60000', '--test-reporter=spec', ...files.map(f => join(FLOWS, f))],
    { env: { E2E_BASE_URL: baseUrl, E2E_FAKE_URL: fakeUrl, E2E_PASSWORD: PASSWORD }, allowFail: true },
  )
}

/** Server-side trouble the browser can't see: unhandled errors, blocked network calls. */
function serverProblems() {
  return serverLog.filter(l => /^\s*⨯|\[e2e preload\] blocked|Error:/.test(l))
}

function stop(child) {
  // A detached child leads its own process group: signal the whole group.
  const kill = sig => {
    try {
      process.kill(child.detached ? -child.pid : child.pid, sig)
    } catch {
      // already gone
    }
  }
  return new Promise(resolve => {
    child.once('exit', resolve)
    kill('SIGTERM')
    setTimeout(() => {
      kill('SIGKILL')
      resolve()
    }, 5000).unref()
  })
}

async function teardown() {
  await Promise.all([...children].map(stop))
  await fake?.close()
}

async function main() {
  const t = Date.now()
  if (process.env.E2E_SKIP_BUILD) console.log('E2E_SKIP_BUILD set: reusing .next')
  else await step('build', build)
  await step('secrets', checkSecrets)
  fake = new FakeGitHub()
  const fakeUrl = await fake.listen()
  const port = await freePort()
  const baseUrl = `http://${HOST}:${port}`
  const server = await step(`start ${baseUrl} (fake GitHub ${fakeUrl})`, () => startNext(port, fakeUrl, baseUrl))
  const code = await step('flows', () => runFlows(baseUrl, fakeUrl), c => c === 0)

  const pids = [...fake.pids].join(', ') || 'none'
  console.log(`\nGitHub API: ${fake.served} requests to the fake, from pid ${pids} (next start is pid ${server.pid})`)
  const problems = serverProblems()
  if (problems.length) console.error(`\nServer log problems:\n  ${problems.join('\n  ')}`)
  const ok = code === 0 && !problems.length
  console.log(`\n${ok ? '✓ e2e passed' : '✗ e2e failed'} in ${((Date.now() - t) / 1000).toFixed(1)}s`)
  return ok ? 0 : 1
}

let tearingDown = false
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (tearingDown) return
    tearingDown = true
    console.error(`\n${signal}: stopping`)
    teardown().finally(() => process.exit(130))
  })
}

main()
  .catch(err => {
    console.error(`\n✗ ${err.message}`)
    if (serverLog.length) console.error(`\nnext start log:\n  ${serverLog.join('\n  ')}`)
    return 1
  })
  .then(async code => {
    tearingDown = true
    await teardown()
    process.exit(code)
  })
