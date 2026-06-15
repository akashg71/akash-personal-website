import Link from 'next/link'
import Nav from '@/components/Nav'

const sections = [
  {
    href: '/engineering',
    title: 'Engineering & AI Research',
    description:
      'Software systems, mechanistic interpretability, and the mathematics behind transformer models.',
  },
  {
    href: '/markets',
    title: 'Markets',
    description:
      'US equities, commodities (silver, gold), and macro. Special focus on AI stocks and the Big 7.',
  },
  {
    href: '/music',
    title: 'Music',
    description: 'Learning guitar and kalimba from scratch. Notes, slow progress, and eventually recordings.',
  },
  {
    href: '/writing',
    title: 'Writing',
    description: 'Personal perspectives on relationships and intimacy.',
  },
]

export default function Home() {
  return (
    <main className="max-w-2xl mx-auto px-6">
      <Nav />

      <section className="mb-16">
        <h1 className="text-2xl font-medium text-stone-900 mb-4">Akash Gupta</h1>
        <p className="text-stone-600 leading-relaxed text-[15px]">
          Software engineer. I actively follow US equities, commodities, and macro for the bigger
          picture. Outside of work I study AI from first principles — transformer math and
          mechanistic interpretability — and I&apos;m learning guitar and kalimba badly.
        </p>
      </section>

      <section className="space-y-8">
        {sections.map(s => (
          <Link key={s.href} href={s.href} className="block group">
            <h2 className="text-stone-900 font-medium group-hover:underline mb-1">{s.title}</h2>
            <p className="text-[13px] text-stone-500 leading-relaxed">{s.description}</p>
          </Link>
        ))}
      </section>

      <footer className="mt-24 pb-12 text-xs text-stone-400">
        <p>Built with Next.js. Updated as things happen.</p>
      </footer>
    </main>
  )
}
