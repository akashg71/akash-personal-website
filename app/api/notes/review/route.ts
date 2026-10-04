import { cookies } from 'next/headers'
import { editNotesFile, isValidSession, NOTES_FILES, SESSION_COOKIE, stampReview } from '@/lib/notes'

export async function POST(request: Request) {
  if (!isValidSession((await cookies()).get(SESSION_COOKIE)?.value)) {
    return Response.json({ error: 'Not signed in — reload the page.' }, { status: 401 })
  }

  // The client sends its *local* date: the server runs in UTC, so stamping with
  // the server's date would be a day off for late-evening/early-morning reviews.
  const body = await request.json().catch(() => null)
  const date = body?.date
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    return Response.json({ error: 'Bad date' }, { status: 400 })
  }

  return editNotesFile(NOTES_FILES.todo, content => {
    const next = stampReview(content, date)
    return next === null ? { noop: true } : { content: next, message: `review: ${date}` }
  })
}
