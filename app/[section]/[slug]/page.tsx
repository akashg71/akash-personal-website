import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'
import { MDXRemote } from 'next-mdx-remote/rsc'
import { getPost, getAllPostSlugs, formatDate, type Section } from '@/lib/content'

const validSections: Section[] = ['engineering', 'markets', 'music', 'writing']

type Params = Promise<{ section: string; slug: string }>

export async function generateStaticParams() {
  return getAllPostSlugs()
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { section, slug } = await params
  if (!validSections.includes(section as Section)) return {}
  try {
    const { meta } = getPost(section as Section, slug)
    return { title: `${meta.title} — Akash Gupta` }
  } catch {
    return {}
  }
}

export default async function PostPage({ params }: { params: Params }) {
  const { section, slug } = await params

  if (!validSections.includes(section as Section)) notFound()

  let post: ReturnType<typeof getPost>
  try {
    post = getPost(section as Section, slug)
  } catch {
    notFound()
  }

  const { meta, content } = post!

  return (
    <main className="max-w-3xl mx-auto px-6">
      <Nav />

      <Link
        href={`/${section}`}
        className="text-xs text-stone-400 hover:text-stone-900 transition-colors mb-10 inline-block"
      >
        ← {section}
      </Link>

      <article>
        {/* Post header */}
        <header className="mb-10">
          <h1 className="text-2xl font-semibold text-stone-900 leading-snug mb-3">
            {meta.title}
          </h1>
          {meta.date && (
            <time className="text-xs text-stone-400 tracking-wide uppercase">
              {formatDate(meta.date)}
            </time>
          )}
          {meta.excerpt && (
            <p className="mt-4 text-[15px] text-stone-500 leading-relaxed border-l-2 border-stone-200 pl-4">
              {meta.excerpt}
            </p>
          )}
        </header>

        <hr className="border-stone-200 mb-10" />

        {/* Article body */}
        <div className="prose prose-stone max-w-none prose-a:text-stone-800 prose-a:underline prose-a:underline-offset-2">
          <MDXRemote source={content} />
        </div>
      </article>

      <div className="mt-16 pt-8 border-t border-stone-100">
        <Link
          href={`/${section}`}
          className="text-xs text-stone-400 hover:text-stone-900 transition-colors"
        >
          ← back to {section}
        </Link>
      </div>
    </main>
  )
}
