// Loaded with `node --import` before the unit tests. Node strips the types
// from .ts files itself; this resolve hook adds the two things the bundler
// normally does: extensionless relative imports ('./paths') and the '@/'
// alias (tsconfig paths '@/*' -> './*'). Only the app's own files are
// touched; node_modules resolve exactly as Node would resolve them.
import { registerHooks } from 'node:module'
import { statSync } from 'node:fs'

const root = new URL('../../', import.meta.url).href
const CANDIDATES = ['.ts', '/index.ts']

const isFile = url => statSync(new URL(url), { throwIfNoEntry: false })?.isFile() ?? false
const isOwn = parent => parent?.startsWith(root) && !parent.includes('/node_modules/')

function target(specifier, parent) {
  if (specifier.startsWith('@/')) return new URL(specifier.slice(2), root).href
  if (/^\.\.?\//.test(specifier) && isOwn(parent)) return new URL(specifier, parent).href
  return null
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const base = target(specifier, context.parentURL)
    const found = base && CANDIDATES.map(ext => base + ext).find(isFile)
    const result = found ? { url: found } : nextResolve(base ?? specifier, context)
    // package.json has no "type", so Node would try CommonJS first, re-parse
    // as ESM and warn once per test file. The app's .ts is always ESM.
    if (isOwn(result.url) && result.url.endsWith('.ts')) {
      return { ...result, format: 'module-typescript', shortCircuit: true }
    }
    return result
  },
})
