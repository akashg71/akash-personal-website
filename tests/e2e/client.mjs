// Client for the fake GitHub's /__fake/* control API (see fake-github.mjs).
// Flow files run in their own processes, so they drive the fake over HTTP.

export function fakeClient(base) {
  async function call(method, path, body) {
    const res = await fetch(`${base}/__fake${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await res.json()
    if (!res.ok && res.status !== 404) throw new Error(`fake GitHub ${method} ${path}: ${res.status} ${JSON.stringify(data)}`)
    return res.ok ? data : null
  }

  return {
    /** Replace the repo with { path: text } in one "seed" commit; clears the request log and faults. */
    reset: files => call('POST', '/reset', { files }),
    /** Commit { path: text | null } as if from another device. Returns { sha }. */
    write: (files, message) => call('POST', '/write', { files, message }),
    /** Current text of a file, or null if it doesn't exist. */
    read: async path => (await call('GET', `/file?path=${encodeURIComponent(path)}`))?.content ?? null,
    /** { head, paths, commits: [{ sha, message, paths }] } — commits newest first. */
    state: () => call('GET', '/state'),
    /** { requests: [{ seq, method, route, path, url, status, pid }], counts: { route: n } } */
    requests: () => call('GET', '/requests'),
    clearRequests: () => call('DELETE', '/requests'),
    /** Queue a fault, e.g. { method: 'PUT', path: 'todo.md', status: 409 } — see FakeGitHub.takeFault. */
    fault: fault => call('POST', '/faults', fault),
    faults: async () => (await call('GET', '/faults')).faults,
    config: config => call('POST', '/config', config),
  }
}
