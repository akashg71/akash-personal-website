import { cookies } from 'next/headers'
import { createNotesFile, isValidSession, NOTES_FILES, SESSION_COOKIE } from '@/lib/notes'

const TEMPLATES: Record<string, string> = {
  [NOTES_FILES.todo]: '# Todo\n\n## This week\n\n## Inbox\n',
  [NOTES_FILES.progress]: '# Progress\n\nWhat has actually landed. Ticked = done; open items are the next real steps.\n\n## Milestones\n',
}

export async function POST(request: Request) {
  if (!isValidSession((await cookies()).get(SESSION_COOKIE)?.value)) {
    return Response.json({ error: 'Not signed in — reload the page.' }, { status: 401 })
  }
  const body = await request.json().catch(() => null)
  const template = TEMPLATES[body?.file]
  if (template === undefined) return Response.json({ error: 'Bad request' }, { status: 400 })
  return createNotesFile(body.file, template)
}
