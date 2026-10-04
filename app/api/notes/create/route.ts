import { cookies } from 'next/headers'
import {
  createNotesFile,
  isFolderPath,
  isValidSession,
  noteHref,
  noteName,
  SESSION_COOKIE,
  TODO_FILE,
  toNotePath,
} from '@/lib/notes'

const TODO_TEMPLATE = '# Todo\n\n## This week\n\n## Inbox\n'

// Body: { kind: 'note', name: "Folder/Note name" } | { kind: 'folder', name: "Folder/Sub" }
export async function POST(request: Request) {
  if (!isValidSession((await cookies()).get(SESSION_COOKIE)?.value)) {
    return Response.json({ error: 'Not signed in — reload the page.' }, { status: 401 })
  }
  const body = await request.json().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name : ''
  const invalid = Response.json(
    { error: 'Use letters, numbers, spaces and - _ . , ( ) & + ! — and / for folders.' },
    { status: 400 },
  )

  if (body?.kind === 'folder') {
    // Git has no empty directories, so a folder is born with a hidden .gitkeep
    // (hidden from the tree like every dot-path).
    const folder = name.split('/').map((s: string) => s.trim()).filter(Boolean).join('/')
    if (!isFolderPath(folder)) return invalid
    return createNotesFile(`${folder}/.gitkeep`, '')
  }

  if (body?.kind === 'note') {
    const path = toNotePath(name)
    if (!path) return invalid
    const content = path === TODO_FILE ? TODO_TEMPLATE : `# ${noteName(path)}\n\n`
    return createNotesFile(path, content, { href: noteHref(path) })
  }

  return Response.json({ error: 'Bad request' }, { status: 400 })
}
