import { cookies } from 'next/headers'
import { checkUpload, UPLOAD_LIMIT } from '@/lib/assets'
import { isNotePath, isValidSession, ISO_DATE_RE, SESSION_COOKIE, uploadImage } from '@/lib/notes'

// POST /api/notes/upload?note=<note path>&name=<file name>&date=<YYYY-MM-DD>
// with the image's bytes as the body. `note` is the note it goes in (the
// answer's `src` is relative to it); `date` is the client's local date.
// GitHub cost: one PUT.
export async function POST(request: Request) {
  if (!isValidSession((await cookies()).get(SESSION_COOKIE)?.value)) {
    return Response.json({ error: 'Not signed in — reload the page.' }, { status: 401 })
  }
  const query = new URL(request.url).searchParams
  const note = query.get('note')
  if (!isNotePath(note)) return Response.json({ error: 'Bad request' }, { status: 400 })
  if (Number(request.headers.get('content-length')) > UPLOAD_LIMIT) {
    return Response.json({ error: 'Images can be up to 4 MB.' }, { status: 413 })
  }

  const bytes = new Uint8Array(await request.arrayBuffer())
  const checked = checkUpload(bytes)
  if ('error' in checked) return Response.json({ error: checked.error }, { status: checked.status })
  const date = query.get('date') ?? ''
  const day = ISO_DATE_RE.test(date) ? date : new Date().toISOString().slice(0, 10)
  return uploadImage(note, bytes, query.get('name') || 'image', day, checked.ext)
}
