// Images in the vault: which files count, how a note's reference finds one,
// and the URL that serves it. Pure and client-safe: the view, the API routes
// and the editor share it.

export const ATTACHMENTS_DIR = 'attachments'

// What the image route serves, by extension. SVG goes out under a sandbox CSP.
const IMAGE_TYPES = new Map([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['gif', 'image/gif'],
  ['webp', 'image/webp'],
  ['avif', 'image/avif'],
  ['svg', 'image/svg+xml'],
])

const dirOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')))
const baseOf = (path: string) => path.slice(path.lastIndexOf('/') + 1)

/** The Content-Type for an image file name, or null if it isn't one we show. */
export function imageType(name: string): string | null {
  const dot = baseOf(name).lastIndexOf('.')
  return dot > 0 ? (IMAGE_TYPES.get(baseOf(name).slice(dot + 1).toLowerCase()) ?? null) : null
}

/** Vault path → blob sha, for every image in the vault. */
export type AssetIndex = Map<string, string>

/** "a/./b/../c" → "a/c"; null if it climbs out of the vault or names nothing. */
export function normalizePath(path: string): string | null {
  const out: string[] = []
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg !== '..') out.push(seg)
    else if (out.pop() === undefined) return null
  }
  return out.length ? out.join('/') : null
}

const isUrl = (src: string) => /^[a-z][a-z\d+.-]*:/i.test(src) || src.startsWith('//')

/**
 * The vault image a markdown ![alt](src) shows: relative to the note's
 * folder, else from the vault root, as GitHub and Obsidian read it. null for
 * a URL or a file the vault doesn't have.
 */
export function resolveImage(note: string, src: string, assets: AssetIndex): string | null {
  if (isUrl(src)) return null
  const path = src
    .replace(/[?#].*$/, '')
    .split('/')
    .map(seg => {
      try {
        return decodeURIComponent(seg) // Obsidian writes "Pasted%20image.png"
      } catch {
        return seg
      }
    })
    .join('/')
  const tries = path.startsWith('/') ? [path] : [`${dirOf(note)}/${path}`, path]
  for (const t of tries) {
    const found = normalizePath(t)
    if (found && assets.has(found)) return found
  }
  return null
}

/**
 * The vault image an Obsidian ![[target]] embed shows: the path as written
 * (relative to the note, then from the root), else the file of that name, or
 * ending in that partial path, anywhere in the vault. The shortest path wins.
 */
export function resolveEmbed(note: string, target: string, assets: AssetIndex): string | null {
  for (const t of [`${dirOf(note)}/${target}`, target]) {
    const found = normalizePath(t)
    if (found && assets.has(found)) return found
  }
  const want = normalizePath(target)?.toLowerCase()
  if (!want) return null
  let best: string | null = null
  for (const path of assets.keys()) {
    const p = path.toLowerCase()
    if (p !== want && !p.endsWith(`/${want}`)) continue
    if (!best || path.length < best.length || (path.length === best.length && path < best)) best = path
  }
  return best
}

/** Where the browser loads a vault image: by blob sha, so it can be cached for good. */
export const imageUrl = (path: string, sha: string) => `/api/notes/blob/${sha}/${encodeURIComponent(baseOf(path))}`

/**
 * The width in Obsidian's size suffix, "300" or "300x200" (an embed's alias,
 * or after "|" in an image's alt). The height is left to the aspect ratio.
 */
export function imageWidth(spec: string): number | undefined {
  const m = spec.trim().match(/^(\d{1,4})(?:x\d{1,4})?$/)
  return m && Number(m[1]) > 0 ? Number(m[1]) : undefined
}

/** "A diagram|300" → alt "A diagram", 300px wide; any other alt is kept whole. */
export function splitAlt(alt: string): { alt: string; width?: number } {
  const bar = alt.lastIndexOf('|')
  const width = bar === -1 ? undefined : imageWidth(alt.slice(bar + 1))
  return width ? { alt: alt.slice(0, bar).trim(), width } : { alt }
}
