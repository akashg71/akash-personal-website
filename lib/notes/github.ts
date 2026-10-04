// Every GitHub API request /notes makes goes through ghFetch: the token, a 10s
// timeout, no Next caching, and the token-expiry header. Server-only.

let tokenExpiration: string | null = null

/** When GITHUB_TOKEN expires, from GitHub's `github-authentication-token-expiration` header (null: never). */
export const getTokenExpiration = () => tokenExpiration

/**
 * `path` is under /repos/<NOTES_REPO>, or '/graphql'. Answers every HTTP status;
 * throws only on a network error or the timeout.
 */
export async function ghFetch(path: string, init: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> } = {}) {
  const url = path === '/graphql'
    ? 'https://api.github.com/graphql'
    : `https://api.github.com/repos/${process.env.NOTES_REPO ?? ''}${path}`
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN ?? ''}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  })
  // Most page loads now get a bare 304, which may not carry the header. Keep the
  // last value then: a new token means a redeploy, which starts a fresh process.
  const expiry = res.headers.get('github-authentication-token-expiration')
  if (expiry) tokenExpiration = expiry
  return res
}
