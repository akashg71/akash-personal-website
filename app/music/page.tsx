import type { Metadata } from 'next'
import Link from 'next/link'
import Nav from '@/components/Nav'
import { getPostsBySection, formatDate } from '@/lib/content'

export const metadata: Metadata = {
  title: 'Music',
}

export default function MusicPage() {
  const posts = getPostsBySection('music')

  return (
    <main className="max-w-2xl mx-auto px-6">
      <Nav />

      <div className="mb-12">
        <h1 className="text-xl font-medium text-stone-900 mb-3">Music</h1>
        <p className="text-sm text-stone-500 leading-relaxed">
          Learning guitar and kalimba, both from scratch, simultaneously. This is a journal — notes
          on what I&apos;m working on, what&apos;s clicking, what isn&apos;t, and eventually some
          recordings.
        </p>
      </div>

      {posts.length === 0 ? (
        <p className="text-sm text-stone-400">Nothing published yet.</p>
      ) : (
        <ul className="space-y-8">
          {posts.map(post => (
            <li key={post.slug}>
              <Link href={`/music/${post.slug}`} className="group flex gap-6 items-baseline">
                <time className="text-xs text-stone-400 shrink-0 w-28">{formatDate(post.date)}</time>
                <div>
                  <h2 className="text-stone-900 group-hover:underline">{post.title}</h2>
                  {post.excerpt && (
                    <p className="text-sm text-stone-500 mt-1">{post.excerpt}</p>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
