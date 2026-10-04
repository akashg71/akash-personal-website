// Every session-checked API route, read from app/api/notes so a new route is
// covered by the 401 checks (e2e and prod smoke) without editing a list.
import { readdirSync } from 'node:fs'

const OPEN = new Set(['login', 'logout'])

export const PROTECTED_ROUTES = readdirSync(new URL('../../app/api/notes/', import.meta.url), { withFileTypes: true })
  .filter(d => d.isDirectory() && !OPEN.has(d.name))
  .map(d => d.name)
  .sort()
