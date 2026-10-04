// A note's YAML frontmatter as a compact block above it, like Obsidian's
// properties. Server component: the YAML parser never reaches the browser,
// and <details> folds it without JS. Every value is React text; only http(s)
// URLs become links.
import { Fragment, type ReactNode } from 'react'
import { parseProperties, readableDate, tagsOf, type PropertyValue, type Scalar } from '@/lib/notes/properties'

const SUMMARY_TAGS = 3

export default function Properties({ yaml }: { yaml: string }) {
  const props = parseProperties(yaml)
  if (props.error !== null) return <Invalid yaml={yaml} error={props.error} />
  if (props.list.length === 0) return null

  const tags = props.list.flatMap(p => tagsOf(p) ?? [])
  return (
    <details className="group mb-6 rounded-md border border-stone-200 bg-white">
      <Summary>
        <span className="font-medium text-stone-600">Properties</span>
        <span className="text-stone-400">{props.list.length}</span>
        {tags.length > 0 && (
          <span className="ml-auto flex min-w-0 items-center gap-1 overflow-hidden group-open:hidden">
            {tags.slice(0, SUMMARY_TAGS).map((t, i) => <Chip key={i}>#{t}</Chip>)}
            {tags.length > SUMMARY_TAGS && <span className="shrink-0 text-stone-400">+{tags.length - SUMMARY_TAGS}</span>}
          </span>
        )}
      </Summary>
      <dl className="grid grid-cols-[fit-content(40%)_minmax(0,1fr)] gap-x-4 gap-y-2 border-t border-stone-100 px-3 py-3 text-sm">
        {props.list.map((p, i) => {
          const tagged = tagsOf(p)
          return (
            <Fragment key={i}>
              <dt className="break-words text-stone-500">{p.key}</dt>
              <dd className="min-w-0 break-words text-stone-800">
                {tagged?.length ? <Chips items={tagged} prefix="#" /> : <Value value={p.value} />}
              </dd>
            </Fragment>
          )
        })}
      </dl>
    </details>
  )
}

/** YAML the parser rejects, shown as written so it can be fixed in the source tab. */
function Invalid({ yaml, error }: { yaml: string; error: string }) {
  return (
    <details open className="group mb-6 rounded-md border border-amber-200 bg-amber-50/60">
      <Summary>
        <span className="font-medium text-stone-600">Properties</span>
        <span className="text-amber-800">· can’t read the YAML</span>
      </Summary>
      <div className="border-t border-amber-200 px-3 py-3">
        <p className="text-xs text-amber-900">{error}. Fix it in the editor’s source tab.</p>
        <pre className="mt-2 overflow-x-auto font-mono text-xs leading-relaxed text-stone-700">{`---\n${yaml}\n---`}</pre>
      </div>
    </details>
  )
}

function Summary({ children }: { children: ReactNode }) {
  return (
    <summary className="flex min-h-11 cursor-pointer select-none list-none items-center gap-2 rounded-md px-3 text-xs [&::-webkit-details-marker]:hidden">
      <span aria-hidden className="text-[10px] text-stone-400 transition-transform group-open:rotate-90">▶</span>
      {children}
    </summary>
  )
}

function Value({ value }: { value: PropertyValue }) {
  if (Array.isArray(value)) return value.length ? <Chips items={value} /> : <Empty />
  if (value !== null && typeof value === 'object') {
    return <code className="block whitespace-pre-wrap font-mono text-xs leading-relaxed text-stone-700">{value.yaml}</code>
  }
  return <ScalarValue value={value} />
}

function Chips({ items, prefix = '' }: { items: Scalar[]; prefix?: string }) {
  return (
    <ul className="flex flex-wrap gap-1">
      {items.map((item, i) => (
        <li key={i} className="min-w-0 max-w-full">
          <Chip>
            {prefix}
            <ScalarValue value={item} />
          </Chip>
        </li>
      ))}
    </ul>
  )
}

function Chip({ children }: { children: ReactNode }) {
  return <span className="block truncate rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-700">{children}</span>
}

const Empty = () => <span className="text-stone-400">empty</span>

function ScalarValue({ value }: { value: Scalar }) {
  if (value === null || value === '') return <Empty />
  if (typeof value === 'boolean') {
    return (
      <>
        <span aria-hidden>{value ? '✓' : '✗'}</span>
        <span className="sr-only">{String(value)}</span>
      </>
    )
  }
  if (typeof value === 'number') return String(value)
  const date = readableDate(value)
  if (date) return <time dateTime={value} title={value}>{date}</time>
  if (/^https?:\/\/\S+$/i.test(value)) {
    return (
      <a href={value} rel="noreferrer" className="break-all underline underline-offset-2 decoration-stone-400 hover:decoration-stone-900">
        {value}
      </a>
    )
  }
  return <span className="whitespace-pre-wrap">{value.replace(/\n$/, '')}</span>
}
