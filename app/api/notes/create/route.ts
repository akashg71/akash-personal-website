import { cookies } from 'next/headers'
import {
  createNotesFile,
  isFolderPath,
  isValidSession,
  ISO_DATE_RE,
  journalPath,
  noteHref,
  noteName,
  SESSION_COOKIE,
  TODO_FILE,
  toNotePath,
} from '@/lib/notes'

const TODO_TEMPLATE = '# Todo\n\n## This week\n\n## Inbox\n'

function dailyTemplate(date: string) {
  // Parse as UTC midnight and format in UTC, so the weekday is the one for that
  // calendar date regardless of the server's timezone.
  const title = new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  })
  return `# ${title}\n\n## Today\n\n## Notes\n`
}

// Body: { kind: 'note', name: "Folder/Note name" } | { kind: 'folder', name: "Folder/Sub" }
//     | { kind: 'daily', date: "YYYY-MM-DD" } (the client's local date)
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

  if (body?.kind === 'daily') {
    const date = body.date
    if (typeof date !== 'string' || !ISO_DATE_RE.test(date) || Number.isNaN(Date.parse(date))) {
      return Response.json({ error: 'Bad date' }, { status: 400 })
    }
    const path = journalPath(date)
    const href = noteHref(path)
    const res = await createNotesFile(path, dailyTemplate(date), { href })
    // Idempotent: already created (other device, double tap) → just open it.
    return res.status === 409 ? Response.json({ ok: true, href }) : res
  }

  if (body?.kind === 'note') {
    const path = toNotePath(name)
    if (!path) return invalid
    const content = path === TODO_FILE ? TODO_TEMPLATE : `# ${noteName(path)}\n\n`
    return createNotesFile(path, content, { href: noteHref(path) })
  }

  return Response.json({ error: 'Bad request' }, { status: 400 })
}
