import { cookies } from 'next/headers'
import {
  addToInbox,
  addToSection,
  editNotesFile,
  isNotePath,
  isValidSession,
  TODO_FILE,
  SESSION_COOKIE,
} from '@/lib/notes'

const MAX_LEN = 300

// Body: { text, file?, heading?: { line, raw } }. No heading → the todo Inbox.
export async function POST(request: Request) {
  if (!isValidSession((await cookies()).get(SESSION_COOKIE)?.value)) {
    return Response.json({ error: 'Not signed in — reload the page.' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  // One line only: a newline would let the "item" inject arbitrary markdown/headings.
  const text = typeof body?.text === 'string' ? body.text.replace(/\s+/g, ' ').trim() : ''
  if (!text) return Response.json({ error: 'Nothing to add.' }, { status: 400 })
  if (text.length > MAX_LEN) return Response.json({ error: `Keep it under ${MAX_LEN} characters.` }, { status: 400 })

  const heading = body.heading
  if (heading !== undefined && !(Number.isInteger(heading?.line) && typeof heading?.raw === 'string')) {
    return Response.json({ error: 'Bad request' }, { status: 400 })
  }
  const file = body.file ?? TODO_FILE
  if (!isNotePath(file)) return Response.json({ error: 'Bad request' }, { status: 400 })

  return editNotesFile(file, content => {
    const next = heading ? addToSection(content, heading, text) : addToInbox(content, text)
    return next === null
      ? { conflict: 'That section changed on GitHub — reload and try again.' }
      : { content: next, message: `add: ${text.slice(0, 50)}` }
  })
}
