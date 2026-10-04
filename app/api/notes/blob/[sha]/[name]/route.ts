import { cookies } from 'next/headers'
import { imageType } from '@/lib/assets'
import { getBlob, isValidSession, SESSION_COOKIE } from '@/lib/notes'

// A vault image by blob sha, which the page looked up in the vault's tree.
// The sha pins the bytes, so a browser keeps them for good; the name only
// picks the Content-Type. GitHub cost: one request per image per device.
export async function GET(request: Request, { params }: { params: Promise<{ sha: string; name: string }> }) {
  if (!isValidSession((await cookies()).get(SESSION_COOKIE)?.value)) {
    return Response.json({ error: 'Not signed in — reload the page.' }, { status: 401 })
  }
  const { sha, name } = await params
  const type = imageType(name)
  if (!/^[0-9a-f]{40}$/.test(sha) || !type) return Response.json({ error: 'Not an image' }, { status: 404 })

  const etag = `"${sha}"`
  const headers: Record<string, string> = {
    'Cache-Control': 'private, max-age=31536000, immutable',
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
    // An SVG opened on its own is a document: it must never run script.
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  }
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers })

  try {
    const blob = await getBlob(sha)
    if (!blob) return Response.json({ error: 'No such image' }, { status: 404 })
    if (blob.size !== null) headers['Content-Length'] = String(blob.size)
    return new Response(blob.body, { headers: { ...headers, 'Content-Type': type } })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'GitHub error' }, { status: 502 })
  }
}
