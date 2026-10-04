import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { splitFrontmatter } from '@/lib/frontmatter'
import { parseMarkdown } from '@/lib/markdown'

// The frontmatter the parser found: up to the end of its yaml node plus the
// closing fence's line ending, and the line that fence is on.
function parsed(content: string) {
  const yaml = parseMarkdown(content).children[0]
  if (yaml?.type !== 'yaml') return { frontmatter: '', lines: 0 }
  // micromark's offsets don't count a BOM.
  const end = (content.startsWith('\uFEFF') ? 1 : 0) + yaml.position!.end.offset!
  const eol = /^(?:\r\n|\r|\n)?/.exec(content.slice(end))![0]
  return { frontmatter: content.slice(0, end + eol.length), lines: yaml.position!.end.line }
}

// [what, content, lines the frontmatter spans (0: none)]
const CASES: [string, string, number][] = [
  ['a typical note', '---\ntitle: Hello\ntags: [a, b]\n---\n# Heading\n\n- [ ] task\n', 4],
  ['no newline after the closing fence', '---\na: 1\n---', 3],
  ['the body right after it', '---\na: 1\n---\n# H', 3],
  ['empty frontmatter', '---\n---\nbody\n', 2],
  ['empty frontmatter, nothing after', '---\n---', 2],
  ['only frontmatter', '---\naliases: [x]\n---\n', 3],
  ['unterminated', '---\na: 1\n\n# H\n', 0],
  ['a lone "---"', '---', 0],
  ['a lone "---" line', '---\n', 0],
  ['spaces and tabs after either fence', '--- \t\na: 1\n---  \nbody', 3],
  ['an indented "---" in a block scalar', '---\na: |\n  ---\n---\nbody', 4],
  ['"----" never opens', '----\na: 1\n----\nbody', 0],
  ['"----" never closes', '---\na: 1\n----\n---\nbody', 4],
  ['"--- x" never closes', '---\na: 1\n--- x\n---\nbody', 4],
  ['a blank line first', '\n---\na: 1\n---\nbody', 0],
  ['an indented opening fence', ' ---\na: 1\n---\nx', 0],
  ['CRLF', '---\r\na: 1\r\nb: 2\r\n---\r\n# H\r\n- [ ] t\r\n', 4],
  ['lone CR line endings', '---\ra: 1\r---\r# H\r', 3],
  ['mixed line endings', '---\r\na: 1\nb: 2\r---\n# H\n', 4],
  ['a BOM', '\uFEFF---\na: 1\n---\n# H\n', 3],
  ['a BOM and CRLF', '\uFEFF---\r\na: 1\r\n---\r\nx', 3],
  ['two BOMs', '\uFEFF\uFEFF---\na: 1\n---\nx', 0],
  ['"..." does not close it', '---\na: 1\n...\nbody\n', 0],
  ['"..." is YAML up to the next "---"', '---\na: 1\n...\n---\nbody\n', 4],
  ['tasks and headings inside the YAML', '---\nnote: |\n  - [ ] fake\n  # fake\nlist:\n- [ ] fake\n---\n- [ ] real\n', 7],
  ['a rule, a line and a rule', '---\nIntro\n---\n\nText\n', 3],
  ['a code fence inside the YAML', '---\na: |\n  ```\n---\n```\ncode\n```\n', 4],
  ['"---" inside a code block', '```\n---\na\n---\n```\n', 0],
  ['a heading first', '# Title\n---\na\n---\n', 0],
  ['a vertical tab after the fence', '---\v\na: 1\n---\nx', 0],
  ['a no-break space after the fence', '--- \na: 1\n---\nx', 0],
  ['an empty file', '', 0],
]

describe('splitFrontmatter', () => {
  test('finds exactly the frontmatter the parser finds', () => {
    for (const [what, content, lines] of CASES) {
      const split = splitFrontmatter(content)
      assert.equal(split.lines, lines, what)
      assert.deepEqual({ frontmatter: split.frontmatter, lines: split.lines }, parsed(content), what)
      assert.equal(split.frontmatter + split.body, content, what)
    }
  })

  test('splits the fences and YAML from the body', () => {
    assert.deepEqual(splitFrontmatter('---\ntitle: x\n---\n# H\n'), { frontmatter: '---\ntitle: x\n---\n', body: '# H\n', lines: 3 })
    assert.deepEqual(splitFrontmatter('# H\n---\n'), { frontmatter: '', body: '# H\n---\n', lines: 0 })
  })

  test('keeps a BOM and CRLF endings in the frontmatter', () => {
    assert.deepEqual(splitFrontmatter('\uFEFF---\r\na: 1\r\n---\r\n\r\nx'), {
      frontmatter: '\uFEFF---\r\na: 1\r\n---\r\n',
      body: '\r\nx',
      lines: 3,
    })
  })

  test('body lines keep their file line numbers', () => {
    const content = '---\na: 1\n---\n# Todo\n\n- [ ] t\n'
    const { lines } = splitFrontmatter(content)
    const task = parseMarkdown(content).children.find(n => n.type === 'list')
    assert.equal(content.split('\n')[lines], '# Todo')
    assert.equal(task?.position?.start.line, 6)
  })
})
