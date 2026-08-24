import { describe, it, expect } from 'vitest'
import { parseUnifiedDiff, parseNumstat, totalChanges } from './diff-parse'

// A modification with one hunk, in the exact shape `git diff` emits.
const MODIFIED = `diff --git a/src/app.ts b/src/app.ts
index 1234567..89abcde 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,4 +1,5 @@
 const a = 1
-const b = 2
+const b = 3
+const c = 4
 const d = 5
`

describe('parseUnifiedDiff', () => {
  it('returns nothing for empty input', () => {
    expect(parseUnifiedDiff('')).toEqual([])
    expect(parseUnifiedDiff('   \n')).toEqual([])
  })

  it('parses a modified file with its hunk and counts', () => {
    const [file] = parseUnifiedDiff(MODIFIED)
    expect(file.path).toBe('src/app.ts')
    expect(file.status).toBe('modified')
    expect(file.binary).toBe(false)
    expect(file.insertions).toBe(2)
    expect(file.deletions).toBe(1)
    expect(file.hunks).toHaveLength(1)
    expect(file.hunks[0].header).toBe('@@ -1,4 +1,5 @@')
  })

  it('numbers old and new lines independently across a hunk', () => {
    const [file] = parseUnifiedDiff(MODIFIED)
    const lines = file.hunks[0].lines
    expect(lines.map((l) => [l.kind, l.oldLine, l.newLine])).toEqual([
      ['context', 1, 1],
      ['del', 2, null],
      ['add', null, 2],
      ['add', null, 3],
      ['context', 3, 4]
    ])
  })

  it('strips the leading marker from line text', () => {
    const [file] = parseUnifiedDiff(MODIFIED)
    expect(file.hunks[0].lines.map((l) => l.text)).toEqual([
      'const a = 1',
      'const b = 2',
      'const b = 3',
      'const c = 4',
      'const d = 5'
    ])
  })

  it('reads an added file from its /dev/null old side', () => {
    const [file] = parseUnifiedDiff(`diff --git a/new.txt b/new.txt
new file mode 100644
index 0000000..e69de29
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+hello
+world
`)
    expect(file.path).toBe('new.txt')
    expect(file.status).toBe('added')
    expect(file.insertions).toBe(2)
    expect(file.deletions).toBe(0)
  })

  it('reads a deleted file and keeps its path from the old side', () => {
    const [file] = parseUnifiedDiff(`diff --git a/gone.txt b/gone.txt
deleted file mode 100644
index e69de29..0000000
--- a/gone.txt
+++ /dev/null
@@ -1,1 +0,0 @@
-was here
`)
    expect(file.path).toBe('gone.txt')
    expect(file.status).toBe('deleted')
    expect(file.deletions).toBe(1)
  })

  it('reads a rename and keeps both paths', () => {
    const [file] = parseUnifiedDiff(`diff --git a/old/name.ts b/new/name.ts
similarity index 96%
rename from old/name.ts
rename to new/name.ts
--- a/old/name.ts
+++ b/new/name.ts
@@ -1,2 +1,2 @@
 keep
-old
+new
`)
    expect(file.status).toBe('renamed')
    expect(file.oldPath).toBe('old/name.ts')
    expect(file.path).toBe('new/name.ts')
  })

  it('flags a binary file and gives it no hunks', () => {
    const [file] = parseUnifiedDiff(`diff --git a/logo.png b/logo.png
index 1234567..89abcde 100644
Binary files a/logo.png and b/logo.png differ
`)
    expect(file.path).toBe('logo.png')
    expect(file.binary).toBe(true)
    expect(file.hunks).toEqual([])
  })

  it('separates multiple files in one diff', () => {
    const files = parseUnifiedDiff(MODIFIED + `diff --git a/other.ts b/other.ts
index aaa..bbb 100644
--- a/other.ts
+++ b/other.ts
@@ -10,2 +10,2 @@
-x
+y
`)
    expect(files.map((f) => f.path)).toEqual(['src/app.ts', 'other.ts'])
    expect(files[1].hunks[0].lines[0].oldLine).toBe(10)
  })

  it('handles several hunks in one file', () => {
    const [file] = parseUnifiedDiff(`diff --git a/m.ts b/m.ts
--- a/m.ts
+++ b/m.ts
@@ -1,2 +1,2 @@
-a
+b
@@ -20,2 +20,2 @@
-c
+d
`)
    expect(file.hunks).toHaveLength(2)
    expect(file.hunks[1].lines[0].oldLine).toBe(20)
    expect(file.insertions).toBe(2)
    expect(file.deletions).toBe(2)
  })

  it('ignores the no-newline marker rather than counting it as a line', () => {
    const [file] = parseUnifiedDiff(`diff --git a/n.txt b/n.txt
--- a/n.txt
+++ b/n.txt
@@ -1,1 +1,1 @@
-old
\\ No newline at end of file
+new
\\ No newline at end of file
`)
    expect(file.insertions).toBe(1)
    expect(file.deletions).toBe(1)
    expect(file.hunks[0].lines).toHaveLength(2)
  })

  it('tolerates a path containing spaces', () => {
    const [file] = parseUnifiedDiff(`diff --git a/my dir/a b.ts b/my dir/a b.ts
--- a/my dir/a b.ts
+++ b/my dir/a b.ts
@@ -1,1 +1,1 @@
-x
+y
`)
    expect(file.path).toBe('my dir/a b.ts')
  })
})

describe('parseNumstat', () => {
  it('returns nothing for empty input', () => {
    expect(parseNumstat('')).toEqual([])
  })

  it('parses tab-separated counts and paths', () => {
    expect(parseNumstat('3\t1\tsrc/a.ts\n0\t7\tsrc/b.ts\n')).toEqual([
      { path: 'src/a.ts', insertions: 3, deletions: 1, binary: false },
      { path: 'src/b.ts', insertions: 0, deletions: 7, binary: false }
    ])
  })

  it('reads a binary entry (dash counts) as binary with zero counts', () => {
    expect(parseNumstat('-\t-\tlogo.png\n')).toEqual([
      { path: 'logo.png', insertions: 0, deletions: 0, binary: true }
    ])
  })

  it('keeps a path containing spaces intact', () => {
    expect(parseNumstat('1\t0\tmy dir/a b.ts\n')[0].path).toBe('my dir/a b.ts')
  })

  it('takes the destination path of a rename', () => {
    // git numstat renders a rename as "old => new" inside the path column.
    expect(parseNumstat('2\t2\told/x.ts => new/x.ts\n')[0].path).toBe('new/x.ts')
  })

  it('skips malformed rows rather than throwing', () => {
    expect(parseNumstat('garbage\n3\t1\tok.ts\n')).toEqual([
      { path: 'ok.ts', insertions: 3, deletions: 1, binary: false }
    ])
  })
})

describe('totalChanges', () => {
  it('sums insertions and deletions across files', () => {
    expect(
      totalChanges([
        { path: 'a', insertions: 3, deletions: 1, binary: false },
        { path: 'b', insertions: 0, deletions: 7, binary: false }
      ])
    ).toEqual({ files: 2, insertions: 3, deletions: 8 })
  })

  it('is zero for no files', () => {
    expect(totalChanges([])).toEqual({ files: 0, insertions: 0, deletions: 0 })
  })
})
