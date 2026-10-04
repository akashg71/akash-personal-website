'use client'

// Loaded only via next/dynamic from NotesView, so Milkdown (ProseMirror, its
// CodeMirror code blocks, and the Vue runtime Crepe uses for its menus) never
// ships with the normal /notes page — only when you tap "edit".
import { useEffect, useRef } from 'react'
import { Crepe } from '@milkdown/crepe'
import { remarkStringifyOptionsCtx } from '@milkdown/kit/core'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import './editor.css'

export default function RichEditor({
  initial,
  onChange,
  onReady,
}: {
  initial: string
  onChange: (markdown: string) => void
  /** Called once with Crepe's own serialization of `initial` — the baseline for "dirty". */
  onReady: (markdown: string) => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const callbacks = useRef({ onChange, onReady })
  useEffect(() => {
    callbacks.current = { onChange, onReady }
  })

  useEffect(() => {
    let ready = false
    const crepe = new Crepe({
      root: root.current,
      defaultValue: initial,
      features: {
        [Crepe.Feature.TopBar]: true, // fixed formatting bar: selection toolbars are fiddly on phones
        // remark-math would parse "$30 … $2,400" in finance notes as an inline formula and
        // rewrite it on save. Off until there's a reason to write maths here.
        [Crepe.Feature.Latex]: false,
        [Crepe.Feature.ImageBlock]: false, // no image storage yet
        [Crepe.Feature.AI]: false,
      },
    })
    // remark-stringify defaults to "*" bullets and "***" rules, so every save would
    // rewrite each "- [ ]" in the file. Match how the files are actually written.
    crepe.editor.config(ctx => {
      ctx.update(remarkStringifyOptionsCtx, prev => ({ ...prev, bullet: '-' as const, rule: '-' as const }))
    })
    crepe.on(api =>
      api.markdownUpdated((_ctx, markdown) => {
        if (ready) callbacks.current.onChange(markdown)
      }),
    )
    crepe.create().then(() => {
      ready = true
      callbacks.current.onReady(crepe.getMarkdown())
    })
    return () => {
      ready = false
      crepe.destroy()
    }
  }, [initial])

  return <div ref={root} className="notes-editor" />
}
