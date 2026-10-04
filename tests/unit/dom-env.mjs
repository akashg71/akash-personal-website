// A browser-like global scope (jsdom) so the real Crepe editor runs under
// node --test. Import it before anything that touches the DOM. Plain JS
// because jsdom ships no types.
import { JSDOM, VirtualConsole } from 'jsdom'

// jsdom reports layout APIs it doesn't implement (scrollTo, ...) on its
// console; the editor works without them.
const virtualConsole = new VirtualConsole()
virtualConsole.on('jsdomError', error => {
  if (!/^Not implemented/.test(error.message)) console.error(error)
})

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  pretendToBeVisual: true, // requestAnimationFrame
  url: 'http://localhost/notes/test.md',
  virtualConsole,
})
export const window = dom.window

for (const key of Object.getOwnPropertyNames(window)) {
  if (key in globalThis) continue
  try {
    globalThis[key] = window[key]
  } catch {
    // a read-only global; Node's own version stays
  }
}
// Node has its own versions of these, and jsdom only accepts its own events.
for (const key of [
  'window', 'document', 'navigator', 'Event', 'CustomEvent', 'EventTarget', 'UIEvent', 'FocusEvent',
  'KeyboardEvent', 'MouseEvent', 'InputEvent', 'CompositionEvent', 'ClipboardEvent', 'MessageEvent',
]) {
  const value = key === 'window' ? window : window[key]
  if (value) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
}
// Called bare, as browser globals (Milkdown's timers listen on the window).
for (const key of ['addEventListener', 'removeEventListener', 'dispatchEvent', 'getComputedStyle', 'getSelection']) {
  globalThis[key] = window[key].bind(window)
}

// Layout APIs jsdom lacks, probed by ProseMirror and CodeMirror.
const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }
window.Range.prototype.getBoundingClientRect = () => rect
window.Range.prototype.getClientRects = () => Object.assign([], { item: () => null })
window.Element.prototype.scrollIntoView = () => {}
window.document.elementFromPoint = () => null
window.matchMedia = query => ({
  matches: false, media: query, onchange: null,
  addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
})
globalThis.matchMedia = window.matchMedia

class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// Crepe mounts CodeMirror in a code block only once it scrolls into view;
// report every observed element as visible, as on a short note.
class IntersectionObserver {
  constructor(callback) {
    this.callback = callback
  }
  observe(target) {
    queueMicrotask(() => this.callback([{ target, isIntersecting: true }], this))
  }
  unobserve() {}
  disconnect() {}
}
for (const [key, value] of Object.entries({ ResizeObserver, IntersectionObserver })) {
  globalThis[key] = value
  window[key] = value
}
