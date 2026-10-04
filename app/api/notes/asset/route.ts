import { cookies } from 'next/headers'
import { after } from 'next/server'
import { imageUrl, resolveImage } from '@/lib/assets'
import { currentSnapshot, isNotePath, isValidSession, listVault, SESSION_COOKIE, vaultOf, warmSnapshot } from '@/lib/notes'

// GET /api/notes/asset?note=<note path>&src=<image src as the note writes it>:
// how the editor shows a vault image. Finds the file from the note, like view
// mode, and redirects to the image route, which browsers cache for good.
// GitHub cost: none on a warm server (a free 304); a cold one lists the tree
// once and builds the snapshot after answering.
export async function GET(request: Request) {
  if (!isValidSession((await cookies()).get(SESSION_COOKIE)?.value)) {
    return Response.json({ error: 'Not signed in — reload the page.' }, { status: 401 })
  }
  const query = new URL(request.url).searchParams
  const note = query.get('note')
  const src = query.get('src')
  if (!isNotePath(note) || !src) return Response.json({ error: 'Bad request' }, { status: 400 })

  try {
    const snap = await currentSnapshot()
    if (!snap) after(warmSnapshot) // so the next image costs nothing
    const { assets } = snap ? vaultOf(snap) : await listVault()
    const path = resolveImage(note, src, assets)
    if (!path) return Response.json({ error: 'No such image' }, { status: 404 })
    return new Response(null, { status: 302, headers: { Location: imageUrl(path, assets.get(path)!), 'Cache-Control': 'no-store' } })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'GitHub error' }, { status: 502 })
  }
}
