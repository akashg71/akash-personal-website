// Fenced code in view mode. Highlighting runs on the server (lib/highlight.ts),
// so the page gets coloured HTML and no highlighter JS; only the copy button
// is client code. Shiki's hast becomes React elements, never raw HTML.
import { Suspense, type ComponentProps, type ReactNode } from 'react'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'
import { toJsxRuntime } from 'hast-util-to-jsx-runtime'
import { highlightToHast, resolveLang } from '@/lib/highlight'
import CopyButton from './CopyButton'

type Props = { code: string; lang?: string | null }

// One box for the plain and the highlighted block, so swapping one for the
// other doesn't move the page.
const PRE = 'px-4 pt-2 pb-4 rounded-b-md text-sm overflow-x-auto'

/** Highlighting is async but renderNote isn't: each block streams in behind its plain twin. */
export default function CodeBlock({ code, lang }: Props) {
  if (!resolveLang(lang)) return <PlainCode code={code} lang={lang} />
  return (
    <Suspense fallback={<PlainCode code={code} lang={lang} />}>
      <HighlightedCode code={code} lang={lang} />
    </Suspense>
  )
}

async function HighlightedCode({ code, lang }: Props) {
  const hast = await highlightToHast(code, lang)
  if (!hast) return <PlainCode code={code} lang={lang} />
  return <Frame lang={lang}>{toJsxRuntime(hast, { Fragment, jsx, jsxs, components: { pre: ShikiPre } })}</Frame>
}

function PlainCode({ code, lang }: Props) {
  return (
    <Frame lang={lang}>
      {/* Focusable so a keyboard can scroll a wide block, as Shiki's <pre> is. */}
      <pre tabIndex={0} className={`${PRE} bg-white text-stone-800`}>
        <code>{code}</code>
      </pre>
    </Frame>
  )
}

/** Shiki's <pre> brings the theme colours inline; this adds the shared box. */
function ShikiPre({ className, ...props }: ComponentProps<'pre'>) {
  return <pre {...props} className={`${className ?? ''} ${PRE}`} />
}

/** The copy button sits in a header row, so on a phone it never hides the end of a line. */
function Frame({ lang, children }: { lang?: string | null; children: ReactNode }) {
  return (
    <div data-code-block className="my-4 rounded-md border border-stone-200 bg-white">
      <div className="flex h-8 items-center justify-between gap-2 pl-4 text-xs">
        <span className="truncate text-stone-400">{lang}</span>
        <CopyButton />
      </div>
      {children}
    </div>
  )
}
