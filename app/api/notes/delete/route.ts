import { cookies } from 'next/headers'
import {
  deleteSection,
  deleteTask,
  editNotesFile,
  headingTitle,
  isNotesFile,
  isValidSession,
  SESSION_COOKIE,
  taskText,
} from '@/lib/notes'

// Body: { file, kind: 'task' | 'section', line, raw } — same addressing as toggle.
export async function POST(request: Request) {
  if (!isValidSession((await cookies()).get(SESSION_COOKIE)?.value)) {
    return Response.json({ error: 'Not signed in — reload the page.' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  if (
    !body || !isNotesFile(body.file) || !['task', 'section'].includes(body.kind) ||
    !Number.isInteger(body.line) || typeof body.raw !== 'string'
  ) {
    return Response.json({ error: 'Bad request' }, { status: 400 })
  }

  const isTask = body.kind === 'task'
  const label = (isTask ? taskText(body.raw) : headingTitle(body.raw)).slice(0, 50)

  return editNotesFile(body.file, content => {
    const next = isTask ? deleteTask(content, body.line, body.raw) : deleteSection(content, { line: body.line, raw: body.raw })
    return next === null
      ? { conflict: 'That changed on GitHub — reload and try again.' }
      : { content: next, message: `${isTask ? 'delete' : 'delete section'}: ${label}` }
  })
}
