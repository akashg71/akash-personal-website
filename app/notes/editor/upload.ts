// Images in the rich editor: shrink a big photo, upload it, and show vault
// images. Part of the editor chunk, so the /notes page never loads it.
import { UPLOAD_LIMIT } from '@/lib/assets'
import { localDate, post } from '../mutate'

const MAX_SIDE = 2560

/**
 * The bytes to upload for a picked, pasted or dropped image. A photo larger
 * than 2560px or 4 MB is drawn again at most 2560px on its longest side, as
 * WebP at 0.85, or JPEG where the browser can't encode WebP (Safari); that
 * also drops its EXIF data. GIFs (they may move) and images small enough go
 * as they are.
 */
export async function prepareImage(file: File): Promise<Blob> {
  if (file.type === 'image/gif') return file
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return file // a type this browser can't draw (HEIC on a desktop): the server checks it
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  if (scale === 1 && file.size <= UPLOAD_LIMIT) {
    bitmap.close()
    return file
  }
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff' // JPEG has no transparency
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  for (const [type, quality] of [['image/webp', 0.85], ['image/jpeg', 0.85], ['image/jpeg', 0.7]] as const) {
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality))
    // An encoder the browser lacks gives PNG instead, so check what came back.
    if (blob?.type === type && blob.size <= UPLOAD_LIMIT) return blob
  }
  return file
}

/** Upload an image for `note`; resolves to the link the note writes (relative to it). */
export async function uploadImage(file: File, note: string): Promise<string> {
  const blob = await prepareImage(file)
  if (blob.size > UPLOAD_LIMIT) throw new Error(`${file.name || 'The image'} is over 4 MB.`)
  const query = new URLSearchParams({ note, name: file.name || 'image', date: localDate() })
  const { src } = await post<{ src: string }>(`/api/notes/upload?${query}`, { 'Content-Type': blob.type || 'application/octet-stream' }, blob)
  return src
}

/**
 * Where the editor loads an image: a URL as it is, a vault path through the
 * route that finds it from the note. An empty block stays empty, so it shows
 * the upload form.
 */
export function displayUrl(note: string, src: string): string {
  if (!src || /^(https?:|data:image\/|blob:)/i.test(src)) return src
  return `/api/notes/asset?${new URLSearchParams({ note, src })}`
}
