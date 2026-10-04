// Syntax highlighting for fenced code in view mode, on the server only: the
// browser gets coloured HTML and never loads Shiki. Never import this from a
// 'use client' module. (No `import 'server-only'`: node --test can't load it.)
import type { Root } from 'hast'
import { createHighlighterCore, type HighlighterCore, type LanguageRegistration } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

// One import() per grammar, so each is its own server chunk and a cold start
// loads only the languages a note uses. All are MIT apart from yaml, whose
// TextMate bundle grants free use in its README instead of a LICENSE file.
const GRAMMARS: Record<string, () => Promise<{ default: LanguageRegistration[] }>> = {
  typescript: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  java: () => import('shiki/langs/java.mjs'),
}

const ALIASES: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript', // the JavaScript grammar covers JSX; saves a 160 KB twin
  jsonc: 'json',
  sh: 'shellscript',
  bash: 'shellscript',
  shell: 'shellscript',
  zsh: 'shellscript',
  py: 'python',
  yml: 'yaml',
  htm: 'html',
  md: 'markdown',
  patch: 'diff',
  golang: 'go',
  rs: 'rust',
}

/** Bigger blocks render plain: not worth ~150 ms of server time per page load. */
export const MAX_HIGHLIGHT_CHARS = 50_000
/** A longer line (minified JSON, say) stays one plain token; the rest is still coloured. */
const MAX_LINE_CHARS = 2_000

/** The grammar for a fence's language ('ts', 'Bash', …), or null when we don't highlight it. */
export function resolveLang(info: string | null | undefined): string | null {
  const name = (info ?? '').trim().toLowerCase()
  const lang = Object.hasOwn(ALIASES, name) ? ALIASES[name] : name
  return Object.hasOwn(GRAMMARS, lang) ? lang : null
}

let highlighter: Promise<HighlighterCore> | null = null
const grammars = new Map<string, Promise<void>>()

function getHighlighter() {
  highlighter ??= createHighlighterCore({
    themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark.mjs')],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  }).catch(err => {
    highlighter = null // let the next request try again
    throw err
  })
  return highlighter
}

function loadGrammar(h: HighlighterCore, lang: string) {
  let loading = grammars.get(lang)
  if (!loading) {
    loading = GRAMMARS[lang]().then(m => h.loadLanguage(m.default))
    loading.catch(() => grammars.get(lang) === loading && grammars.delete(lang))
    grammars.set(lang, loading)
  }
  return loading
}

/**
 * Shiki's hast for one fenced block: github-light colours inline, github-dark
 * in --shiki-dark / --shiki-dark-bg variables for a dark mode to switch to.
 * Null means render the plain block: unknown language, too big, or any
 * failure. Never throws.
 */
export async function highlightToHast(code: string, info: string | null | undefined): Promise<Root | null> {
  const lang = resolveLang(info)
  if (!lang || code.length > MAX_HIGHLIGHT_CHARS) return null
  try {
    const h = await getHighlighter()
    await loadGrammar(h, lang)
    return h.codeToHast(code, {
      lang,
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: 'light',
      tokenizeMaxLineLength: MAX_LINE_CHARS,
    })
  } catch {
    return null
  }
}

// Start the engine and themes while the page is still waiting on GitHub.
getHighlighter().catch(() => {})
