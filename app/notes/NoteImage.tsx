// An image in view mode: a vault file through the image route, or an http(s)
// URL. Tapping it opens it full size in a new tab. No client JS.

export default function NoteImage({
  url,
  alt,
  width,
  missing,
  inLink = false,
}: {
  /** null: the file isn't in the vault, so a placeholder names `missing`. */
  url: string | null
  alt: string
  width?: number
  missing?: string
  /** Inside a markdown link already: that link is the tap target. */
  inLink?: boolean
}) {
  if (!url) {
    return (
      <span
        title="Not found in the notes repo"
        className="inline-block max-w-full break-all rounded border border-dashed border-stone-300 px-1.5 py-0.5 text-xs text-stone-500"
      >
        missing image: {missing}
      </span>
    )
  }
  const img = (
    // eslint-disable-next-line @next/next/no-img-element -- private images behind the session; next/image can't fetch them
    <img
      src={url}
      alt={alt}
      width={width}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className="inline max-w-full h-auto rounded align-bottom"
    />
  )
  if (inLink) return img
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="inline-block max-w-full">
      {img}
    </a>
  )
}
