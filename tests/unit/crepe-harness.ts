// The rich editor's real Crepe (app/notes/editor/configure.ts), headless in
// jsdom. `roundTrip` returns what a save writes for a note that was opened
// and saved without a change.
import { window } from './dom-env.mjs'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import { createEditor, type Features } from '../../app/notes/editor/configure'

export async function openEditor(markdown: string, features?: Features) {
  const root = window.document.createElement('div')
  window.document.body.append(root)
  const crepe = createEditor(root, markdown, features)
  await crepe.create()
  const view = () => crepe.editor.action(ctx => ctx.get(editorViewCtx))
  return {
    crepe,
    view,
    markdown: () => crepe.getMarkdown(),
    /** Put the cursor right after the first `text` in the document. */
    cursorAfter(text: string) {
      const v = view()
      let at = -1
      v.state.doc.descendants((node, pos) => {
        const i = at === -1 && node.isText ? node.text!.indexOf(text) : -1
        if (i !== -1) at = pos + i + text.length
      })
      if (at === -1) throw new Error(`no ${JSON.stringify(text)} in the editor`)
      v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, at)))
    },
    /** Type at the cursor one key at a time, through the input rules as a browser does. */
    type(text: string) {
      const v = view()
      for (const key of text) {
        const { from, to } = v.state.selection
        const insert = () => v.state.tr.insertText(key, from, to)
        if (!v.someProp('handleTextInput', f => f(v, from, to, key, insert))) v.dispatch(insert())
      }
    },
    async close() {
      await crepe.destroy()
      root.remove()
    },
  }
}

export async function roundTrip(markdown: string, features?: Features) {
  const editor = await openEditor(markdown, features)
  try {
    return editor.markdown()
  } finally {
    await editor.close()
  }
}

/** Ends the jsdom window, so the test process can exit. */
export const closeWindow = () => window.close()
