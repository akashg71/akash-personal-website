// Loaded into `next start` with NODE_OPTIONS=--import, so it runs before Next
// patches fetch: Next's patched fetch wraps this one and every GitHub call the
// app makes still lands here. NODE_OPTIONS is inherited, so any process Next
// forks loads it too; each request carries its pid (x-e2e-pid) to show which.
//
// api.github.com goes to the fake GitHub at FAKE_GITHUB_URL. Any other
// non-local http(s) request is refused, so a test run can never reach a real
// repo or depend on the network.
const fake = process.env.FAKE_GITHUB_URL
if (!fake) throw new Error('tests/e2e/preload.mjs needs FAKE_GITHUB_URL')

const realFetch = globalThis.fetch
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

const urlOf = input => new URL(input instanceof Request ? input.url : String(input))

globalThis.fetch = function fetch(input, init) {
  const url = urlOf(input)
  if (url.hostname === 'api.github.com') {
    const target = new URL(url.pathname + url.search, fake)
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    headers.set('x-e2e-pid', String(process.pid))
    return realFetch(input instanceof Request ? new Request(target, input) : target, { ...init, headers })
  }
  if (/^https?:$/.test(url.protocol) && !LOCAL_HOSTS.has(url.hostname)) {
    console.error(`[e2e preload] blocked fetch to ${url.origin}`)
    return Promise.reject(new TypeError(`e2e: blocked request to ${url.origin}`))
  }
  return realFetch(input, init)
}

console.log(`[e2e preload] pid ${process.pid}: api.github.com → ${fake}`)
