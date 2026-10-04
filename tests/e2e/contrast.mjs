// WCAG 2 AA contrast for e2e checks. The browser only reports colours
// (sampleColours); judging them is pure, so tests/unit covers the maths.

/** @typedef {[number, number, number, number]} RGBA sRGB 0-255 and alpha 0-1 */
/** @typedef {{ backgrounds: RGBA[], opacity: number }} Behind innermost background first */
/** @typedef {Behind & { tag: string, text: string, color: RGBA, size: number, weight: number }} TextSample */
/**
 * @typedef {{ tag: string, name: string, focused: boolean, color: RGBA, placeholder: RGBA | null,
 *   inside: Behind, border: RGBA | null, around: Behind }} FieldSample
 */

const channel = c => {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/** Relative luminance of an sRGB colour [r, g, b] (0-255). */
export function luminance([r, g, b]) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** Contrast ratio of two opaque colours, from 1 to 21. */
export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** `top` [r, g, b, alpha 0-1] painted over the opaque `base` [r, g, b]. */
export function over([r, g, b, a], base) {
  return [r, g, b].map((c, i) => c * a + base[i] * (1 - a))
}

/**
 * What AA asks of a piece of text: 3:1 when it is large (24px, or 18.66px
 * bold) or only glyphs such as × / ▶ (icons, judged as graphics), else 4.5:1.
 */
export function requiredRatio({ text, size, weight }) {
  const glyphs = !/[\p{L}\p{N}]/u.test(text)
  const large = size >= 24 || (size >= 18.66 && weight >= 700)
  return glyphs || large ? 3 : 4.5
}

/**
 * Everything below its required ratio, as readable lines. Text is judged
 * against what is behind it; a text field's typed text and placeholder against
 * its inside (4.5:1), and its border, when it has one all round, against what
 * is around it (3:1: the border is what shows an empty field and its focus).
 * Backgrounds are a stack, innermost first, painted over white; a colour is
 * painted over the result at the sample's opacity.
 * @param {{ text?: TextSample[], fields?: FieldSample[] }} samples
 * @returns {string[]}
 */
export function contrastFailures({ text = [], fields = [] }) {
  const rgb = c => `rgb(${c.map(Math.round).join(', ')})`
  const judge = (color, { backgrounds, opacity }, need, what) => {
    const bg = backgrounds.toReversed().reduce((under, layer) => over(layer, under), [255, 255, 255])
    const fg = over([...color.slice(0, 3), color[3] * opacity], bg)
    const ratio = contrastRatio(fg, bg)
    return ratio >= need ? [] : [`${ratio.toFixed(2)}:1 < ${need}:1 for ${what} (${rgb(fg)} on ${rgb(bg)})`]
  }
  return [
    ...text.flatMap(s => judge(s.color, s, requiredRatio(s), `<${s.tag}> "${s.text}"`)),
    ...fields.flatMap(f => {
      const name = `<${f.tag}> "${f.name}"${f.focused ? ' (focused)' : ''}`
      return [
        ...judge(f.color, f.inside, 4.5, `the text of ${name}`),
        ...(f.placeholder ? judge(f.placeholder, f.inside, 4.5, `the placeholder of ${name}`) : []),
        ...(f.border ? judge(f.border, f.around, 3, `the border of ${name}`) : []),
      ]
    }),
  ]
}

/**
 * Runs in the page (page.evaluate): every visible, enabled element with text
 * of its own, and every visible, enabled text field. Colours come back as sRGB
 * numbers through a 1px canvas, whatever the CSS wrote (lab(), color-mix(),
 * alpha).
 * @returns {{ text: TextSample[], fields: FieldSample[] }}
 */
export function sampleColours() {
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  const rgba = css => {
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = '#000'
    ctx.fillStyle = css
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    return [r, g, b, a / 255]
  }
  const shown = el => el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
  // Backgrounds from `el` outwards to the first opaque one, and the opacity on the way.
  const behind = el => {
    const backgrounds = []
    let opacity = 1
    for (let n = el; n; n = n.parentElement) {
      const style = getComputedStyle(n)
      opacity *= Number(style.opacity)
      const bg = rgba(style.backgroundColor)
      if (bg[3] > 0 && backgrounds.at(-1)?.[3] !== 1) backgrounds.push(bg)
    }
    return { backgrounds, opacity }
  }

  const text = []
  for (const el of document.body.querySelectorAll('*')) {
    const own = [...el.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join('').trim()
    if (!own || !shown(el) || el.closest('[aria-hidden="true"], :disabled, script, style, noscript')) continue
    const style = getComputedStyle(el)
    text.push({
      tag: el.tagName.toLowerCase(),
      text: own.slice(0, 60),
      color: rgba(style.color),
      size: parseFloat(style.fontSize),
      weight: Number(style.fontWeight),
      ...behind(el),
    })
  }

  const fields = []
  for (const el of document.body.querySelectorAll('input, textarea')) {
    if (!shown(el) || el.disabled || ['checkbox', 'radio', 'hidden'].includes(el.type)) continue
    const style = getComputedStyle(el)
    const boxed = ['Top', 'Right', 'Bottom', 'Left'].every(side => parseFloat(style[`border${side}Width`]) >= 1)
    fields.push({
      tag: el.tagName.toLowerCase(),
      name: el.getAttribute('placeholder') || el.getAttribute('name') || el.type,
      focused: el === document.activeElement,
      color: rgba(style.color),
      placeholder: el.getAttribute('placeholder') ? rgba(getComputedStyle(el, '::placeholder').color) : null,
      inside: behind(el),
      border: boxed ? rgba(style.borderTopColor) : null,
      around: behind(el.parentElement),
    })
  }
  return { text, fields }
}
