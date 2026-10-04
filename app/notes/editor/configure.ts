// The rich editor's Crepe set-up, shared by RichEditor and the round-trip
// unit tests so both run the very same editor. No CSS imports here (node
// can't load them); RichEditor adds the themes.
import { Crepe, CrepeFeature } from '@milkdown/crepe'
import { remarkStringifyOptionsCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { imageBlockSchema } from '@milkdown/kit/component/image-block'
import { codeBlockSchema, imageSchema } from '@milkdown/kit/preset/commonmark'

export type Features = Partial<Record<CrepeFeature, boolean>>

const features: Features = {
  [CrepeFeature.TopBar]: true, // fixed formatting bar: selection toolbars are fiddly on phones
  // remark-math would parse "$30 … $2,400" in finance notes as an inline formula and
  // rewrite it on save. Off until there's a reason to write maths here.
  [CrepeFeature.Latex]: false,
  [CrepeFeature.ImageBlock]: false, // no image storage yet
  [CrepeFeature.AI]: false,
}

/** A Crepe editor on `markdown`, ready for `create()`. `overrides` is for tests. */
export function createEditor(root: Node | null, markdown: string, overrides: Features = {}): Crepe {
  const enabled = { ...features, ...overrides }
  const crepe = new Crepe({ root, defaultValue: markdown, features: enabled })
  crepe.editor.config(matchFileStyle).config(keepImages).config(keepCodeInfo)
  if (enabled[CrepeFeature.ImageBlock]) crepe.editor.config(keepImageBlockAlt)
  return crepe
}

// remark-stringify defaults to "*" bullets and "***" rules, so every save would
// rewrite each "- [ ]" in the file. Match how the files are actually written.
function matchFileStyle(ctx: Ctx) {
  ctx.update(remarkStringifyOptionsCtx, prev => ({ ...prev, bullet: '-' as const, rule: '-' as const }))
}

// mdast gives an untitled image `title: null`, the image node only accepts a
// string, and Milkdown drops a node that fails: every ![alt](src) without a
// title vanished on save.
function keepImages(ctx: Ctx) {
  ctx.update(imageSchema.key, prev => c => {
    const schema = prev(c)
    return {
      ...schema,
      parseMarkdown: {
        ...schema.parseMarkdown,
        runner: (state, node, type) => {
          state.addNode(type, { src: node.url ?? '', alt: node.alt ?? '', title: node.title ?? '' })
        },
      },
    }
  })
}

// Crepe keeps a fence's language but drops the rest of its info string, so
// ```ts title="a.ts" lost its title on every save.
function keepCodeInfo(ctx: Ctx) {
  ctx.update(codeBlockSchema.key, prev => c => {
    const schema = prev(c)
    return {
      ...schema,
      attrs: { ...schema.attrs, meta: { default: '', validate: 'string' } },
      parseMarkdown: {
        ...schema.parseMarkdown,
        runner: (state, node, type) => {
          state.openNode(type, { language: node.lang ?? '', meta: node.meta ?? '' })
          if (node.value) state.addText(node.value as string)
          state.closeNode()
        },
      },
      toMarkdown: {
        ...schema.toMarkdown,
        runner: (state, node) => {
          state.addNode('code', undefined, node.content.firstChild?.text ?? '', {
            lang: node.attrs.language || null,
            meta: node.attrs.meta || null,
          })
        },
      },
    }
  })
}

// ImageBlock stores its resize ratio in the alt text, so ![A diagram](x.png)
// saved as ![1.00](x.png). Keep the alt and the caption; a resize isn't saved.
function keepImageBlockAlt(ctx: Ctx) {
  ctx.update(imageBlockSchema.key, prev => c => {
    const schema = prev(c)
    return {
      ...schema,
      attrs: { ...schema.attrs, alt: { default: '', validate: 'string' } },
      parseMarkdown: {
        ...schema.parseMarkdown,
        runner: (state, node, type) => {
          state.addNode(type, { src: node.url ?? '', caption: node.title ?? '', ratio: 1, alt: node.alt ?? '' })
        },
      },
      toMarkdown: {
        ...schema.toMarkdown,
        runner: (state, node) => {
          state.openNode('paragraph')
          state.addNode('image', undefined, undefined, {
            url: node.attrs.src,
            title: node.attrs.caption || null,
            alt: node.attrs.alt,
          })
          state.closeNode()
        },
      },
    }
  })
}
