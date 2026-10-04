// One write at a time across the whole page (ticks, quick-add, review). Parallel
// writes would all read the same sha and all but one would 409 — serializing
// avoids self-inflicted conflicts and keeps the server's single retry for real ones.
let chain: Promise<unknown> = Promise.resolve()

export function mutate(url: string, body: unknown): Promise<void> {
  const run = chain.then(async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error ?? `Save failed (${res.status})`)
    }
  })
  chain = run.catch(() => {}) // a failed write must not block the next one
  return run
}

export function localDate() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
