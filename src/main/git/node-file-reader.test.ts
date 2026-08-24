import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { nodeFileReader, MAX_COUNT_BYTES } from './node-file-reader'

// Real files, not a mocked fs: the thing under test is what happens when the
// filesystem is asked, and a mock would assume the answer.
let root: string
let tree: string
let outside: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'seniordev-reader-'))
  tree = join(root, 'tree')
  outside = join(root, 'outside')
  mkdirSync(tree, { recursive: true })
  mkdirSync(outside, { recursive: true })

  writeFileSync(join(tree, 'plain.txt'), 'a\nb\n')
  writeFileSync(join(tree, 'empty.txt'), '')
  // A content marker that does NOT appear in the file's path, so the assertion
  // below distinguishes "read the link text" from "read the target's contents".
  writeFileSync(join(outside, 'secret.txt'), Array.from({ length: 500 }, (_, i) => `LEAKED-CONTENTS-${i}`).join('\n'))
  // A symlink pointing OUT of the tree. This is the containment case: the
  // lexical path check passes because the link itself is inside the tree.
  symlinkSync(join(outside, 'secret.txt'), join(tree, 'escape.txt'))
  symlinkSync(join(root, 'nothing-here'), join(tree, 'dangling.txt'))
  mkdirSync(join(tree, 'adir'))
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('nodeFileReader', () => {
  it('reads an ordinary file', async () => {
    expect(await nodeFileReader(tree, 'plain.txt')).toEqual({ kind: 'text', content: 'a\nb\n' })
  })

  it('reads an empty file as empty text, not as unreadable', async () => {
    expect(await nodeFileReader(tree, 'empty.txt')).toEqual({ kind: 'text', content: '' })
  })

  it('NEVER follows a symlink out of the tree', async () => {
    // The containment check is lexical, so the link passes it; only lstat stops
    // the read from opening whatever it points at.
    const r = await nodeFileReader(tree, 'escape.txt')
    expect(r.kind).toBe('text')
    if (r.kind === 'text') {
      expect(r.content).not.toContain('LEAKED-CONTENTS')
      // git stores a symlink's blob as the target PATH, so this is what
      // `git diff --no-index --numstat` counts: one line.
      expect(r.content).toBe(join(outside, 'secret.txt'))
      expect(r.content.includes('\n')).toBe(false)
    }
  })

  it('handles a dangling symlink without throwing', async () => {
    const r = await nodeFileReader(tree, 'dangling.txt')
    expect(r.kind).toBe('text')
  })

  it('rejects a path that climbs out of the tree', async () => {
    expect(await nodeFileReader(tree, '../outside/secret.txt')).toEqual({ kind: 'unreadable' })
  })

  it('rejects an absolute path outside the tree', async () => {
    expect(await nodeFileReader(tree, join(outside, 'secret.txt'))).toEqual({ kind: 'unreadable' })
  })

  it('reports a missing file as unreadable', async () => {
    expect(await nodeFileReader(tree, 'no-such-file.txt')).toEqual({ kind: 'unreadable' })
  })

  it('reports a directory as unreadable rather than trying to read it', async () => {
    expect(await nodeFileReader(tree, 'adir')).toEqual({ kind: 'unreadable' })
  })

  it('reports an oversized file as TOO-LARGE, distinct from unreadable', async () => {
    const big = join(tree, 'big.bin')
    writeFileSync(big, Buffer.alloc(MAX_COUNT_BYTES + 1024, 0x41))
    try {
      expect(await nodeFileReader(tree, 'big.bin')).toEqual({ kind: 'too-large' })
    } finally {
      rmSync(big, { force: true })
    }
  })

  it('reads a file just under the cap', async () => {
    const ok = join(tree, 'ok.bin')
    writeFileSync(ok, Buffer.alloc(1024, 0x41))
    try {
      expect((await nodeFileReader(tree, 'ok.bin')).kind).toBe('text')
    } finally {
      rmSync(ok, { force: true })
    }
  })
})
