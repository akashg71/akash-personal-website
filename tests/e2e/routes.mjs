// Every session-checked API route and its methods, read from app/api/notes so
// a new route is covered by the 401 checks (e2e and prod smoke) without
// editing a list. A dynamic segment like [sha] gets a placeholder value.
import { readdirSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const API = fileURLToPath(new URL('../../app/api/notes/', import.meta.url))
const OPEN = new Set(['login', 'logout'])
const PLACEHOLDER = { sha: '0'.repeat(40), name: 'x.png' }

/** [{ path: 'toggle', method: 'POST' }, { path: 'blob/000…/x.png', method: 'GET' }, …] */
export const PROTECTED_ROUTES = readdirSync(API, { recursive: true })
  .filter(f => f.endsWith(`${sep}route.ts`))
  .map(f => f.split(sep).slice(0, -1))
  .filter(segs => !OPEN.has(segs[0]))
  .flatMap(segs => {
    const source = readFileSync(join(API, ...segs, 'route.ts'), 'utf8')
    const path = segs.map(s => s.replace(/^\[(\w+)\]$/, (_, key) => PLACEHOLDER[key] ?? 'x')).join('/')
    return [...source.matchAll(/^export async function (GET|POST)\b/gm)].map(m => ({ path, method: m[1] }))
  })
  .sort((a, b) => a.path.localeCompare(b.path))

export const describeRoute = ({ path, method }) => `${method} ${path}`
