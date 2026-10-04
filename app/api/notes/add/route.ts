import { cookies } from 'next/headers'
import { addToInbox, editNotesFile, isValidSession, NOTES_FILES, SESSION_COOKIE } from '@/lib/notes'

const MAX_LEN = 300

export async function POST(request: Request) {
  if (!isValidSession((await cookies()).get(SESSION_COOKIE)?.value)) {
    return Response.json({ error: 'Not signed in — reload the page.' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  // One line only: a newline would let the "item" inject arbitrary markdown/headings.
  const text = typeof body?.text === 'string' ? body.text.replace(/\s+/g, ' ').trim() : ''
  if (!text) return Response.json({ error: 'Nothing to add.' }, { status: 400 })
  if (text.length > MAX_LEN) return Response.json({ error: `Keep it under ${MAX_LEN} characters.` }, { status: 400 })

  return editNotesFile(NOTES_FILES.todo, content => ({
    content: addToInbox(content, text),
    message: `add: ${text.slice(0, 50)}`,
  }))
}
