'use client'

// Loaded only via next/dynamic from NotesView, so Milkdown (ProseMirror, its
// CodeMirror code blocks, and the Vue runtime Crepe uses for its menus) never
// ships with the normal /notes page — only when you tap "edit".
import { useEffect, useRef } from 'react'
import { editorViewCtx } from '@milkdown/kit/core'
import { Selection } from '@milkdown/kit/prose/state'
import { createEditor } from './editor/configure'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import './editor.css'

export default function RichEditor({
  initial,
  onChange,
  onReady,
  autoFocus = false,
}: {
  initial: string
  onChange: (markdown: string) => void
  /** Called once with Crepe's own serialization of `initial` — the baseline for "dirty". */
  onReady: (markdown: string) => void
  /** Put the cursor at the end, ready to type (new notes). */
  autoFocus?: boolean
}) {
  const root = useRef<HTMLDivElement>(null)
  const callbacks = useRef({ onChange, onReady })
  useEffect(() => {
    callbacks.current = { onChange, onReady }
  })

  useEffect(() => {
    let ready = false
    const crepe = createEditor(root.current, initial)
    crepe.on(api =>
      api.markdownUpdated((_ctx, markdown) => {
        if (ready) callbacks.current.onChange(markdown)
      }),
    )
    crepe.create().then(() => {
      ready = true
      callbacks.current.onReady(crepe.getMarkdown())
      if (autoFocus) {
        crepe.editor.action(ctx => {
          const view = ctx.get(editorViewCtx)
          view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)))
          view.focus()
        })
      }
    })
    return () => {
      ready = false
      crepe.destroy()
    }
    // autoFocus only matters for the first mount; not a reason to remount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial])

  return <div ref={root} className="notes-editor" />
}
