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
  project?: string
}

export interface PostGroup {
  project: string
  posts: PostMeta[]
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
        project: data.project ?? undefined,
      }
    })
    .sort((a, b) => (a.date > b.date ? -1 : 1))
}

// Groups a section's posts by their `project` frontmatter field (falling back
// to the post's own title for anything ungrouped, so a one-off post still
// renders as its own section instead of silently vanishing). Groups are
// ordered by their most recent post, newest first; posts within a group keep
// the same newest-first order getPostsBySection already produces.
export function getGroupedPostsBySection(section: Section): PostGroup[] {
  const posts = getPostsBySection(section)
  const order: string[] = []
  const byProject = new Map<string, PostMeta[]>()

  for (const post of posts) {
    const key = post.project ?? post.title
    if (!byProject.has(key)) {
      byProject.set(key, [])
      order.push(key)
    }
    byProject.get(key)!.push(post)
  }

  // order[] was built in newest-first post order, so the first time we see
  // each project key is already that project's most recent post — no
  // separate sort needed.
  return order.map(project => ({ project, posts: byProject.get(project)! }))
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
