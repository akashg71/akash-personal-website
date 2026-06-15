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
    <main className="max-w-2xl mx-auto px-6">
      <Nav />

      <Link
        href={`/${section}`}
        className="text-xs text-stone-400 hover:text-stone-900 transition-colors mb-10 inline-block"
      >
        ← {section}
      </Link>

      <article>
        <h1 className="text-2xl font-medium text-stone-900 mb-2">{meta.title}</h1>
        {meta.date && (
          <time className="text-xs text-stone-400">{formatDate(meta.date)}</time>
        )}
        <div className="mt-10 prose prose-stone max-w-none prose-a:text-stone-900">
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
