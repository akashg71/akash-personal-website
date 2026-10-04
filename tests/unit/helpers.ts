// Shared by the line-edit suites. Notes written on Windows keep their CRLF
// endings, so every edit is checked on an LF file and on its CRLF twin.
import assert from 'node:assert/strict'

export const crlf = (s: string) => s.replace(/\n/g, '\r\n')

/**
 * Runs `edit` on `md` and on the same file with CRLF endings, and returns the
 * LF result. The CRLF result must be exactly the LF one with \r\n endings:
 * never mixed, never a lone \r. `cr` is what ends the raw line the page sends
 * back ('' or '\r'), since the page splits the file on \n only.
 */
export function eachEol(md: string, edit: (content: string, cr: string) => string | null) {
  assert.ok(md.includes('\n'), 'a one-line file has no line ending to keep')
  const lf = edit(md, '')
  assert.equal(edit(crlf(md), '\r'), lf === null ? null : crlf(lf))
  return lf
}
