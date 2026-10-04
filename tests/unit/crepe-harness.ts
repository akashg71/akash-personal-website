// The rich editor's real Crepe (app/notes/editor/configure.ts), headless in
// jsdom. `roundTrip` returns what a save writes for a note that was opened
// and saved without a change.
import { window } from './dom-env.mjs'
import { createEditor, type Features } from '../../app/notes/editor/configure'

export async function openEditor(markdown: string, features?: Features) {
  const root = window.document.createElement('div')
  window.document.body.append(root)
  const crepe = createEditor(root, markdown, features)
  await crepe.create()
  return {
    crepe,
    markdown: () => crepe.getMarkdown(),
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
