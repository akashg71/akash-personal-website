import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import {
  GitHubError,
  getNotesFile,
  isValidSession,
  patchTask,
  putNotesFile,
  SESSION_COOKIE,
} from '@/lib/notes'

type Body = { line: number; raw: string; checked: boolean }

export async function POST(request: Request) {
  const session = (await cookies()).get(SESSION_COOKIE)?.value
  if (!isValidSession(session)) {
    return NextResponse.json({ error: 'Not signed in — reload the page.' }, { status: 401 })
  }

  let body: Body
  try {
    body = await request.json()
    if (!Number.isInteger(body.line) || typeof body.raw !== 'string' || typeof body.checked !== 'boolean') {
      throw new Error()
    }
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }

  // We never PUT content the client sent. Each attempt re-reads the file, patches
  // exactly one line, and PUTs with the sha it just read. A 409 means someone
  // committed between our GET and PUT (another device, or a GitHub-side edit) —
  // re-read and try once more; if it conflicts again, surface it.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { content, sha } = await getNotesFile()
      const result = patchTask(content, body.line, body.raw, body.checked)

      if (result.kind === 'noop') return NextResponse.json({ ok: true })
      if (result.kind === 'not-found') {
        return NextResponse.json(
          { error: 'This item changed on GitHub — reload to see the current file.' },
          { status: 409 },
        )
      }

      const verb = body.checked ? 'tick' : 'untick'
      await putNotesFile(result.content, sha, `${verb}: ${result.text.slice(0, 50)}`)
      return NextResponse.json({ ok: true })
    } catch (err) {
      if (err instanceof GitHubError && err.status === 409 && attempt === 0) continue
      const conflict = err instanceof GitHubError && err.status === 409
      return NextResponse.json(
        {
          error: conflict
            ? 'File kept changing while saving — reload and try again.'
            : `Save failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        },
        { status: conflict ? 409 : 502 },
      )
    }
  }
  throw new Error('unreachable')
}
