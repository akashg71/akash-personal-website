import { cookies } from 'next/headers'
import { editNotesFile, isNotePath, isValidSession, renameHeading, renameTask, SESSION_COOKIE } from '@/lib/notes'

const MAX_LEN = 300

// Body: { file, kind: 'task' | 'section', line, raw, text } — same addressing as toggle.
export async function POST(request: Request) {
  if (!isValidSession((await cookies()).get(SESSION_COOKIE)?.value)) {
    return Response.json({ error: 'Not signed in — reload the page.' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  if (
    !body || !isNotePath(body.file) || !['task', 'section'].includes(body.kind) ||
    !Number.isInteger(body.line) || typeof body.raw !== 'string'
  ) {
    return Response.json({ error: 'Bad request' }, { status: 400 })
  }
  // One line only — a newline would split the item / inject markdown structure.
  const text = typeof body.text === 'string' ? body.text.replace(/\s+/g, ' ').trim() : ''
  if (!text) return Response.json({ error: 'Text can’t be empty — use × to delete.' }, { status: 400 })
  if (text.length > MAX_LEN) return Response.json({ error: `Keep it under ${MAX_LEN} characters.` }, { status: 400 })

  const isTask = body.kind === 'task'
  return editNotesFile(body.file, content => {
    const next = isTask
      ? renameTask(content, body.line, body.raw, text)
      : renameHeading(content, { line: body.line, raw: body.raw }, text)
    if (next === null) return { conflict: 'That changed on GitHub — reload and try again.' }
    if (next === content) return { noop: true }
    return { content: next, message: `edit: ${text.slice(0, 50)}` }
  })
}
