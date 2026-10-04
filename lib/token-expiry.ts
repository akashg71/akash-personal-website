// GitHub sends `github-authentication-token-expiration` on API responses made
// with a token that expires: "2027-10-03 00:00:00 UTC", or for some tokens
// "2027-10-03 00:00:00 -0700". Pure and dependency-free so it's unit-testable;
// anything unrecognised gives null, never a throw or a guessed date.

const EXPIRY_RE = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)\s*(UTC|GMT|Z|[+-]\d{2}:?\d{2})?$/i
const DAY_MS = 86_400_000

export type TokenWarning = { days: number; date: string }

/** Minutes east of UTC for "+0100" or "-07:00"; 0 for UTC, GMT, Z or no zone. */
function offsetMinutes(zone = '') {
  const m = zone.match(/^([+-])(\d{2}):?(\d{2})$/)
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0
}

/** When the token expires (epoch ms) and the date as GitHub wrote it; null if absent or unrecognised. */
export function parseTokenExpiry(header: unknown): { at: number; date: string } | null {
  if (typeof header !== 'string') return null
  const m = header.trim().match(EXPIRY_RE)
  if (!m) return null
  const [, date, time, zone] = m
  const wall = Date.parse(`${date}T${time}Z`) // the clock time as written, read as UTC
  // Date.parse rolls impossible dates over (02-30 → 03-02): it must read back as the same day.
  if (Number.isNaN(wall) || new Date(wall).toISOString().slice(0, 10) !== date) return null
  return { at: wall - offsetMinutes(zone) * 60_000, date }
}

/**
 * What the /notes banner needs when the token expires within `withinDays`:
 * whole days left (a part day counts as one, 0 once expired) and the date.
 * null when it's further off, or the header is missing or unrecognised.
 */
export function tokenExpiryWarning(header: unknown, now = Date.now(), withinDays = 30): TokenWarning | null {
  const expiry = parseTokenExpiry(header)
  if (!expiry) return null
  const days = Math.max(0, Math.ceil((expiry.at - now) / DAY_MS))
  return days <= withinDays ? { days, date: expiry.date } : null
}
