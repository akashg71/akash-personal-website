import type { Viewport } from 'next'
import type { ReactNode } from 'react'
import './notes.css'

// /notes follows the system light/dark setting; the rest of the site stays light.
// The browser bars match the page, and color-scheme paints a dark canvas before
// the CSS arrives.
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafaf9' },
    { media: '(prefers-color-scheme: dark)', color: '#0c0a09' },
  ],
  colorScheme: 'light dark',
}

// Every /notes page renders inside .notes-root: notes.css keys dark mode off it.
export default function NotesLayout({ children }: { children: ReactNode }) {
  return <div className="notes-root">{children}</div>
}
