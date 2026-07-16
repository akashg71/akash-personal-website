import Link from 'next/link'

const links = [
  { href: '/engineering', label: 'engineering' },
  { href: '/markets', label: 'markets' },
  { href: '/music', label: 'music' },
  { href: '/writing', label: 'writing' },
]

export default function Nav() {
  return (
    <nav className="flex items-center justify-between py-6 mb-12 border-b border-stone-100">
      <Link
        href="/"
        className="text-sm font-medium text-stone-900 hover:text-stone-500 transition-colors"
      >
        akashic
      </Link>
      <div className="flex gap-6">
        {links.map(l => (
          <Link
            key={l.href}
            href={l.href}
            className="text-sm text-stone-500 hover:text-stone-900 transition-colors"
          >
            {l.label}
          </Link>
        ))}
      </div>
    </nav>
  )
}
