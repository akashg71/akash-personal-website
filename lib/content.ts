import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'

export type Section = 'engineering' | 'markets' | 'music' | 'writing'

export interface PostMeta {
  slug: string
  title: string
  date: string
  excerpt: string
  section: Section
}

const contentDir = path.join(process.cwd(), 'content')

export function getPostsBySection(section: Section): PostMeta[] {
  const dir = path.join(contentDir, section)
  if (!fs.existsSync(dir)) return []

  return fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.mdx'))
    .map(filename => {
      const slug = filename.replace('.mdx', '')
      const { data } = matter(fs.readFileSync(path.join(dir, filename), 'utf8'))
      return {
        slug,
        title: data.title ?? slug,
        date: data.date ?? '',
        excerpt: data.excerpt ?? '',
        section,
      }
    })
    .sort((a, b) => (a.date > b.date ? -1 : 1))
}

export function getPost(section: Section, slug: string) {
  const fullPath = path.join(contentDir, section, `${slug}.mdx`)
  const { data, content } = matter(fs.readFileSync(fullPath, 'utf8'))
  return { meta: data as { title: string; date: string; excerpt?: string }, content }
}

export function getAllPostSlugs() {
  const sections: Section[] = ['engineering', 'markets', 'music', 'writing']
  return sections.flatMap(section =>
    getPostsBySection(section).map(p => ({ section, slug: p.slug }))
  )
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}
