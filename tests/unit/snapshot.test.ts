// The vault snapshot against the e2e suite's fake GitHub, run in-process:
// which requests each read costs, and what it then serves.
import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { FAKE_REPO, FAKE_TOKEN, FakeGitHub } from '../e2e/fake-github.mjs'
import { getTokenExpiration } from '@/lib/notes/github'
import {
  applyWrite,
  getSnapshot,
  gitBlobSha,
  graphqlBatches,
  lastUpdated,
  readNote,
  resetSnapshot,
  SnapshotUnavailable,
  vaultEntries,
  type ContentsWrite,
} from '@/lib/notes/snapshot'

const fake = new FakeGitHub()
const realFetch = globalThis.fetch

before(async () => {
  const url = await fake.listen()
  process.env.GITHUB_TOKEN = FAKE_TOKEN
  process.env.NOTES_REPO = FAKE_REPO
  globalThis.fetch = (input, init) => realFetch(String(input).replace('https://api.github.com', url), init)
})
after(async () => {
  globalThis.fetch = realFetch
  await fake.close()
})

/** Requests since the last call, as "route status". */
function calls() {
  const out = fake.requests.map((r: { route: string; status: number }) => `${r.route} ${r.status}`)
  fake.requests = []
  return out.sort()
}

const text = async (path: string) => readNote(await getSnapshot(), path)?.content

/** A Contents API PUT, as lib/notes.ts sends it. */
async function put(path: string, content: string) {
  const sha = fake.repo.files.get(path)?.sha
  const res = await fetch(`https://api.github.com/repos/${FAKE_REPO}/contents/${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${FAKE_TOKEN}` },
    body: JSON.stringify({ message: `edit ${path}`, content: Buffer.from(content).toString('base64'), sha }),
  })
  return (await res.json()) as ContentsWrite
}

const seed: Record<string, string> = { 'todo.md': '# Todo\n\n- [ ] a\n', '.obsidian/app.json': '{}', 'img/cat.png': 'PNG' }
for (let i = 0; i < 150; i++) seed[`Notes/n${i}.md`] = `# Note ${i}\n`
seed['Big/huge.md'] = `${'x'.repeat(600_000)}\n`
seed['bom.md'] = '﻿# BOM note\n'

describe('snapshot sync', () => {
  beforeEach(() => {
    fake.reset(seed)
    resetSnapshot()
  })

  test('cold: HEAD, tree, two GraphQL batches, one raw blob; attachments never downloaded', async () => {
    const snap = await getSnapshot()
    assert.deepEqual(calls(), ['commits.get 200', 'git.blobs.get 200', 'git.trees.get 200', 'graphql 200', 'graphql 200'])
    assert.equal(snap.notes.length, 153)
    assert.deepEqual(snap.folders.sort(), ['Big', 'Notes'], 'img/ holds no note')
    assert.deepEqual(snap.assets, [{ path: 'img/cat.png', sha: fake.repo.files.get('img/cat.png').sha, size: 3 }])
    assert.equal(readNote(snap, 'Big/huge.md')?.content, seed['Big/huge.md'])
    assert.equal(readNote(snap, 'bom.md')?.content, seed['bom.md'], 'BOM kept, like getNotesFile')
    assert.equal(readNote(snap, 'img/cat.png'), null)
  })

  test('warm and unchanged: one free 304; concurrent reads share it', async () => {
    await getSnapshot()
    calls()
    await Promise.all([getSnapshot(), getSnapshot(), getSnapshot()])
    assert.deepEqual(calls(), ['commits.get 304'])
    assert.equal(await text('todo.md'), seed['todo.md'])
  })

  test('another device commits a note: only that blob is downloaded', async () => {
    await getSnapshot()
    calls()
    fake.write({ 'todo.md': '# Todo\n\n- [x] a\n' })
    assert.equal(await text('todo.md'), '# Todo\n\n- [x] a\n')
    assert.deepEqual(calls(), ['commits.get 200', 'git.trees.get 200', 'graphql 200'])
  })

  test('our own write: the next read is a free 304 that shows it, date included', async () => {
    await getSnapshot()
    const res = await put('New/idea.md', '# Idea\n')
    calls()
    applyWrite('New/idea.md', '# Idea\n', res)
    const snap = await getSnapshot()
    assert.deepEqual(calls(), ['commits.get 304'])
    assert.equal(snap.commit, fake.repo.head.sha)
    assert.equal(readNote(snap, 'New/idea.md')?.content, '# Idea\n')
    assert.ok(snap.folders.includes('New'))
    const sha = readNote(snap, 'New/idea.md')?.sha ?? ''
    assert.equal(await lastUpdated('New/idea.md', sha, async () => assert.fail('asked GitHub')), res.commit.committer?.date)
  })

  test('our own image upload: the next read is a free 304 that lists it; its folder stays hidden', async () => {
    await getSnapshot()
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3])
    const res = await fetch(`https://api.github.com/repos/${FAKE_REPO}/contents/attachments/a.png`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${FAKE_TOKEN}` },
      body: JSON.stringify({ message: 'upload', content: bytes.toString('base64') }),
    }).then(r => r.json() as Promise<ContentsWrite>)
    calls()
    applyWrite('attachments/a.png', bytes, res)
    const snap = await getSnapshot()
    assert.deepEqual(calls(), ['commits.get 304'])
    assert.deepEqual(snap.assets.at(-1), { path: 'attachments/a.png', sha: gitBlobSha(bytes), size: 8 })
    assert.equal(snap.notes.length, 153)
    assert.ok(!snap.folders.includes('attachments'))
  })

  test('our write on top of a commit we have not seen: re-lists the tree, keeps our blob', async () => {
    await getSnapshot()
    fake.write({ 'Notes/n1.md': 'changed elsewhere\n' })
    const res = await put('todo.md', 'mine\n')
    calls()
    applyWrite('todo.md', 'mine\n', res)
    const snap = await getSnapshot()
    assert.deepEqual(calls(), ['commits.get 200', 'git.trees.get 200', 'graphql 200'])
    assert.equal(readNote(snap, 'todo.md')?.content, 'mine\n')
    assert.equal(readNote(snap, 'Notes/n1.md')?.content, 'changed elsewhere\n')
  })

  test('a write during a sync shows on the next read', async () => {
    await getSnapshot()
    fake.write({ 'Notes/n2.md': 'elsewhere\n' })
    fake.faults.push({ route: 'git.trees.get', delayMs: 100, times: 1 })
    const slow = getSnapshot()
    await new Promise(r => setTimeout(r, 20))
    applyWrite('todo.md', 'mine\n', await put('todo.md', 'mine\n'))
    await slow
    assert.equal(await text('todo.md'), 'mine\n')
  })

  test('GraphQL refused: a few notes come one by one; too many fail the snapshot', async () => {
    fake.faults.push({ route: 'graphql', status: 403, times: 10 })
    await assert.rejects(getSnapshot(), SnapshotUnavailable)
    fake.faults = []
    await getSnapshot()
    fake.faults.push({ route: 'graphql', status: 403, times: 10 })
    fake.write({ 'todo.md': 'new\n' })
    calls()
    assert.equal(await text('todo.md'), 'new\n')
    assert.deepEqual(calls(), ['commits.get 200', 'git.blobs.get 200', 'git.trees.get 200', 'graphql 403'])
  })

  test('an empty repo is an empty vault', async () => {
    fake.reset({})
    assert.deepEqual(await getSnapshot(), { commit: '', etag: null, notes: [], folders: [], assets: [] })
  })

  test('the token expiry survives a response without the header', async () => {
    fake.tokenExpiration = '2030-01-01 00:00:00 UTC'
    await getSnapshot()
    fake.tokenExpiration = null
    await getSnapshot()
    assert.equal(getTokenExpiration(), '2030-01-01 00:00:00 UTC')
    fake.tokenExpiration = '2099-01-01 00:00:00 UTC'
  })
})

describe('snapshot helpers', () => {
  test('gitBlobSha matches git hash-object', () => {
    assert.equal(gitBlobSha('hello\n'), 'ce013625030ba8dba906f756967f9e9ca394464a')
    assert.equal(gitBlobSha(''), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391')
  })

  test('vaultEntries: notes in any case, no dot-paths, symlinks or submodules', () => {
    const e = (path: string, type = 'blob', mode = '100644') => ({ path, type, mode, sha: 'x', size: 1 })
    const { notes, folders } = vaultEntries([
      e('a.md'), e('B.MD'), e('pic.png'), e('.obsidian', 'tree', '040000'), e('.obsidian/x.md'),
      e('Dir', 'tree', '040000'), e('Dir/.hidden.md'), e('Dir/link.md', 'blob', '120000'), e('sub', 'commit', '160000'),
    ])
    assert.deepEqual(notes.map(n => n.path), ['a.md', 'B.MD'])
    assert.deepEqual(folders, [])
  })

  test('vaultEntries: images are assets; a folder shows if it holds a note or a .gitkeep', () => {
    const e = (path: string, type = 'blob', mode = '100644') => ({ path, type, mode, sha: path, size: 1 })
    const dir = (path: string) => e(path, 'tree', '040000')
    const { notes, folders, assets } = vaultEntries([
      e('pic.PNG'), dir('attachments'), e('attachments/a.webp'), e('attachments/b.pdf'),
      dir('A'), dir('A/B'), e('A/B/n.md'), dir('Empty'), e('Empty/.gitkeep'), dir('.obsidian'), e('.obsidian/x.png'),
      e('link.png', 'blob', '120000'),
    ])
    assert.deepEqual(notes.map(n => n.path), ['A/B/n.md'])
    assert.deepEqual(folders, ['A', 'A/B', 'Empty'])
    assert.deepEqual(assets.map(a => a.path), ['pic.PNG', 'attachments/a.webp'])
    assert.deepEqual(assets[0], { path: 'pic.PNG', sha: 'pic.PNG', size: 1 })
  })

  test('graphqlBatches: at most 100 blobs and about 1 MB each; big blobs left out', () => {
    const e = (size: number, i: number) => ({ path: `${i}.md`, sha: String(i), size })
    assert.deepEqual(graphqlBatches(Array.from({ length: 250 }, (_, i) => e(10, i))).map(b => b.length), [100, 100, 50])
    assert.deepEqual(graphqlBatches([e(400_000, 0), e(400_000, 1), e(400_000, 2), e(600_000, 3)]).map(b => b.length), [2, 1])
  })
})
