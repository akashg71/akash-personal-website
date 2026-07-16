import type { Metadata } from 'next'
import Link from 'next/link'
import Nav from '@/components/Nav'
import { getPostsBySection, formatDate } from '@/lib/content'

export const metadata: Metadata = {
  title: 'Engineering & AI Research',
}

export default function EngineeringPage() {
  const posts = getPostsBySection('engineering')

  return (
    <main className="max-w-2xl mx-auto px-6">
      <Nav />

      <div className="mb-12">
        <h1 className="text-xl font-medium text-stone-900 mb-3">Engineering & AI Research</h1>
        <p className="text-sm text-stone-500 leading-relaxed">
          Notes on software systems, transformer math, and mechanistic interpretability. Currently
          focused on understanding how language models work from first principles — the math with
          intuition, not just the API.
        </p>
      </div>

      {posts.length === 0 ? (
        <p className="text-sm text-stone-400">Nothing published yet.</p>
      ) : (
        <ul className="space-y-8">
          {posts.map(post => (
            <li key={post.slug}>
              <Link href={`/engineering/${post.slug}`} className="group flex gap-6 items-baseline">
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
