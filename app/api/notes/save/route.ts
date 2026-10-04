import { cookies } from 'next/headers'
import { isNotesFile, isValidSession, saveNotesFile, SESSION_COOKIE } from '@/lib/notes'

// GitHub's Contents API caps files at 1 MB; a todo list anywhere near this is a bug.
const MAX_BYTES = 200_000

export async function POST(request: Request) {
  if (!isValidSession((await cookies()).get(SESSION_COOKIE)?.value)) {
    return Response.json({ error: 'Not signed in — reload the page.' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  if (!isNotesFile(body?.file) || typeof body.content !== 'string' || typeof body.sha !== 'string' || !body.sha) {
    return Response.json({ error: 'Bad request' }, { status: 400 })
  }
  if (Buffer.byteLength(body.content) > MAX_BYTES) {
    return Response.json({ error: 'File too large.' }, { status: 400 })
  }

  return saveNotesFile(body.file, body.content, body.sha)
}
