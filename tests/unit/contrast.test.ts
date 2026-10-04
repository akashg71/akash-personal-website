import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contrastFailures, contrastRatio, luminance, over, requiredRatio } from '../e2e/contrast.mjs'

type RGBA = [number, number, number, number]
const hex = (h: string, alpha = 1): RGBA => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), alpha]
const rgb = (h: string) => hex(h).slice(0, 3)
const PAGE = hex('#0c0a09') // the dark /notes background
const SURFACE = hex('#1c1917') // dark inputs, cards, dialogs

const text = (color: RGBA, backgrounds: RGBA[], extra = {}) => ({
  tag: 'span', text: 'updated just now', color, backgrounds, opacity: 1, size: 16, weight: 400, ...extra,
})
const field = (extra = {}) => ({
  tag: 'input', name: 'New item', focused: false,
  color: hex('#e7e5e4'), placeholder: hex('#999189'), border: hex('#6b6560'),
  inside: { backgrounds: [SURFACE], opacity: 1 }, around: { backgrounds: [PAGE], opacity: 1 },
  ...extra,
})

test('luminance runs from 0 for black to 1 for white', () => {
  assert.equal(luminance([0, 0, 0]), 0)
  assert.equal(luminance([255, 255, 255]), 1)
  assert.ok(luminance([0, 255, 0]) > luminance([255, 0, 0])) // green weighs most
})

test('contrast ratio matches known WCAG pairs, in either order', () => {
  assert.equal(contrastRatio([0, 0, 0], [255, 255, 255]), 21)
  assert.equal(contrastRatio([255, 255, 255], [0, 0, 0]), 21)
  assert.equal(contrastRatio([9, 99, 199], [9, 99, 199]), 1)
  // #767676 is the lightest grey that passes 4.5:1 on white; #777777 just fails.
  assert.equal(contrastRatio(rgb('#767676'), [255, 255, 255]).toFixed(2), '4.54')
  assert.equal(contrastRatio(rgb('#777777'), [255, 255, 255]).toFixed(2), '4.48')
})

test('over paints a translucent colour onto the base', () => {
  assert.deepEqual(over([0, 0, 0, 0.2], [255, 255, 255]), [204, 204, 204])
  assert.deepEqual(over([10, 20, 30, 1], [255, 255, 255]), [10, 20, 30])
  assert.deepEqual(over([10, 20, 30, 0], [1, 2, 3]), [1, 2, 3])
})

test('large text and glyph-only text need 3:1, other text 4.5:1', () => {
  const need = (text: string, size = 16, weight = 400) => requiredRatio({ text, size, weight })
  assert.equal(need('Inbox'), 4.5)
  assert.equal(need('Todo', 24), 3)
  assert.equal(need('Todo', 18.66, 700), 3)
  assert.equal(need('Todo', 18.66, 600), 4.5)
  assert.equal(need('Todo', 20), 4.5)
  for (const glyph of ['×', '/', '▶', '·', '…', '+']) assert.equal(need(glyph), 3, glyph)
  for (const word of ['2', 'é', '日記', '+ add item']) assert.equal(need(word), 4.5, word)
})

test('no failures when every sample passes', () => {
  assert.deepEqual(contrastFailures({ text: [text(hex('#999189'), [PAGE])], fields: [field()] }), [])
  assert.deepEqual(contrastFailures({}), [])
})

test('reports text below its ratio, with the colours it was judged on', () => {
  // Light mode's muted stone-400 on the page: the reason dark mode remaps it.
  assert.deepEqual(contrastFailures({ text: [text(hex('#a6a09b'), [hex('#fafaf9')])] }), [
    '2.48:1 < 4.5:1 for <span> "updated just now" (rgb(166, 160, 155) on rgb(250, 250, 249))',
  ])
  // 3.44:1 is enough for a × glyph but not for a word.
  const faint = hex('#6b6560')
  assert.deepEqual(contrastFailures({ text: [text(faint, [PAGE], { text: '×' })] }), [])
  assert.equal(contrastFailures({ text: [text(faint, [PAGE], { text: 'delete' })] }).length, 1)
})

test('opacity, of the element or of its colour, fades the text into its background', () => {
  const body = hex('#e7e5e4')
  const faded = '1.94:1 < 4.5:1 for <span> "updated just now" (rgb(67, 65, 64) on rgb(12, 10, 9))'
  assert.deepEqual(contrastFailures({ text: [text(body, [PAGE])] }), [])
  assert.deepEqual(contrastFailures({ text: [text(body, [PAGE], { opacity: 0.25 })] }), [faded])
  assert.deepEqual(contrastFailures({ text: [text(hex('#e7e5e4', 0.25), [PAGE])] }), [faded])
})

test('backgrounds stack innermost first and sit on white when none is opaque', () => {
  // The active tree row: stone-200 at 70% over the page.
  const row = contrastFailures({ text: [text(hex('#3a3532', 1), [hex('#3a3532', 0.7), PAGE])] })
  assert.match(row[0], /on rgb\(44, 40, 38\)\)$/)
  // A 20% black veil with nothing opaque under it is over white.
  const veil = contrastFailures({ text: [text(hex('#ffffff'), [[0, 0, 0, 0.2]])] })
  assert.match(veil[0], /\(rgb\(255, 255, 255\) on rgb\(204, 204, 204\)\)$/)
})

test('fields: typed text and placeholder need 4.5:1 inside, the border 3:1 around', () => {
  const failures = (extra: object) => contrastFailures({ fields: [field(extra)] })
  // Tailwind's default placeholder (half the text colour) on a dark input.
  assert.deepEqual(failures({ placeholder: hex('#e7e5e4', 0.5) }), [
    '4.39:1 < 4.5:1 for the placeholder of <input> "New item" (rgb(130, 127, 126) on rgb(28, 25, 23))',
  ])
  assert.match(failures({ color: hex('#57534e') })[0], /for the text of <input> "New item"/)
  assert.match(failures({ border: hex('#3a3532'), focused: true })[0], /^1\.63:1 < 3:1 for the border of <input> "New item" \(focused\)/)
  // No placeholder, or no border all round (a divider underneath), is not judged.
  assert.deepEqual(failures({ placeholder: null, border: null }), [])
})
