import { cookies } from 'next/headers'
import { addSection, editNotesFile, isNotesFile, isValidSession, SESSION_COOKIE } from '@/lib/notes'

const MAX_LEN = 100

export async function POST(request: Request) {
  if (!isValidSession((await cookies()).get(SESSION_COOKIE)?.value)) {
    return Response.json({ error: 'Not signed in — reload the page.' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  if (!isNotesFile(body?.file)) return Response.json({ error: 'Bad request' }, { status: 400 })
  // Single line, and leading #s dropped: the route always writes a level-2 heading.
  const title = typeof body.title === 'string' ? body.title.replace(/\s+/g, ' ').replace(/^#+\s*/, '').trim() : ''
  if (!title) return Response.json({ error: 'Give the section a name.' }, { status: 400 })
  if (title.length > MAX_LEN) return Response.json({ error: `Keep it under ${MAX_LEN} characters.` }, { status: 400 })

  return editNotesFile(body.file, content => {
    const next = addSection(content, title)
    return next === null
      ? { conflict: `A section called “${title}” already exists.` }
      : { content: next, message: `section: ${title.slice(0, 50)}` }
  })
}
