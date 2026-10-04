// Obsidian-style file tree (server component). Folders are native <details>, so
// expand/collapse needs no JS; the folder holding the open note starts expanded.
import Link from 'next/link'
import { noteHref, noteName } from '@/lib/notes'
import InlineAdd from './InlineAdd'

type TreeNode =
  | { type: 'folder'; name: string; path: string; children: TreeNode[] }
  | { type: 'note'; name: string; path: string }

export function buildTree(notes: string[], folders: string[]): TreeNode[] {
  const root: TreeNode[] = []
  const dirs = new Map<string, TreeNode[]>([['', root]])
  const ensure = (path: string): TreeNode[] => {
    const existing = dirs.get(path)
    if (existing) return existing
    const cut = path.lastIndexOf('/')
    const children: TreeNode[] = []
    ensure(cut === -1 ? '' : path.slice(0, cut)).push({ type: 'folder', name: path.slice(cut + 1), path, children })
    dirs.set(path, children)
    return children
  }
  folders.forEach(ensure)
  for (const path of notes) {
    const cut = path.lastIndexOf('/')
    ensure(cut === -1 ? '' : path.slice(0, cut)).push({ type: 'note', name: noteName(path), path })
  }
  const dated = /^\d{4}-\d{2}-\d{2}/
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
      // Date-named notes (journal) newest first, so today is at the top of Journal/.
      if (dated.test(a.name) && dated.test(b.name)) return b.name.localeCompare(a.name)
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    })
    nodes.forEach(n => n.type === 'folder' && sort(n.children))
    return nodes
  }
  return sort(root)
}

export default function VaultTree({ tree, current }: { tree: TreeNode[]; current: string | null }) {
  const folder = current?.includes('/') ? current.slice(0, current.lastIndexOf('/')) : ''
  const prefix = folder ? `${folder}/` : ''
  return (
    <nav className="text-sm">
      <div className="flex flex-col items-start mb-3">
        <InlineAdd
          trigger="new note"
          placeholder="Folder/Note name"
          url="/api/notes/create"
          body={{ kind: 'note' }}
          field="name"
          prefix={prefix}
        />
        <InlineAdd
          trigger="new folder"
          placeholder="Folder name"
          url="/api/notes/create"
          body={{ kind: 'folder' }}
          field="name"
          prefix={prefix}
        />
      </div>
      {tree.length === 0 ? <p className="text-stone-400">No notes yet.</p> : <Nodes nodes={tree} current={current} />}
    </nav>
  )
}

function Nodes({ nodes, current }: { nodes: TreeNode[]; current: string | null }) {
  return (
    <ul>
      {nodes.map(n =>
        n.type === 'folder' ? (
          <li key={n.path}>
            <details open={Boolean(current?.startsWith(`${n.path}/`))} className="group">
              <summary className="flex items-center gap-1.5 min-h-9 -mx-2 px-2 rounded cursor-pointer select-none text-stone-700 hover:bg-stone-100 list-none [&::-webkit-details-marker]:hidden">
                <span className="text-stone-400 text-xs transition-transform group-open:rotate-90">▶</span>
                {n.name}
              </summary>
              <div className="ml-1.5 pl-3 border-l border-stone-200">
                {n.children.length ? (
                  <Nodes nodes={n.children} current={current} />
                ) : (
                  <p className="min-h-9 flex items-center text-xs text-stone-400">empty</p>
                )}
              </div>
            </details>
          </li>
        ) : (
          <li key={n.path}>
            <Link
              href={noteHref(n.path)}
              aria-current={n.path === current ? 'page' : undefined}
              className={`flex items-center min-h-9 -mx-2 px-2 rounded truncate ${
                n.path === current ? 'bg-stone-200/70 text-stone-900 font-medium' : 'text-stone-600 hover:bg-stone-100'
              }`}
            >
              {n.name}
            </Link>
          </li>
        ),
      )}
    </ul>
  )
}
