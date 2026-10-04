import { cookies } from 'next/headers'
import { editNotesFile, isNotePath, isValidSession, patchTask, SESSION_COOKIE } from '@/lib/notes'

export async function POST(request: Request) {
  if (!isValidSession((await cookies()).get(SESSION_COOKIE)?.value)) {
    return Response.json({ error: 'Not signed in — reload the page.' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  if (
    !body || !isNotePath(body.file) || !Number.isInteger(body.line) ||
    typeof body.raw !== 'string' || typeof body.checked !== 'boolean'
  ) {
    return Response.json({ error: 'Bad request' }, { status: 400 })
  }

  return editNotesFile(body.file, content => {
    const r = patchTask(content, body.line, body.raw, body.checked)
    if (r.kind === 'noop') return { noop: true }
    if (r.kind === 'not-found') return { conflict: 'This item changed on GitHub — reload to see the current file.' }
    return { content: r.content, message: `${body.checked ? 'tick' : 'untick'}: ${r.text.slice(0, 50)}` }
  })
}
