import { describe, it, expect } from 'vitest'
import {
  treeLabel,
  describeChanges,
  describeSessions,
  statusMark,
  statusLabel,
  lineMark,
  lineNumberWidth
} from './review-view'

describe('treeLabel', () => {
  it('takes the last segment of a posix path', () => {
    expect(treeLabel('/Users/h/code/seniordev-app')).toBe('seniordev-app')
  })
  it('takes the last segment of a windows path', () => {
    expect(treeLabel('C:\\Users\\hardy\\code\\app')).toBe('app')
  })
  it('ignores a trailing separator', () => {
    expect(treeLabel('/a/b/')).toBe('b')
  })
  it('returns a bare name unchanged', () => {
    expect(treeLabel('repo')).toBe('repo')
  })
})

describe('describeChanges', () => {
  it('singularises one file', () => {
    expect(describeChanges({ files: 1, insertions: 3, deletions: 0 })).toBe('1 file, +3 -0')
  })
  it('pluralises more than one', () => {
    expect(describeChanges({ files: 4, insertions: 10, deletions: 2 })).toBe('4 files, +10 -2')
  })
})

describe('describeSessions', () => {
  it('is empty for no sessions', () => {
    expect(describeSessions([])).toBe('')
  })
  it('names one', () => {
    expect(describeSessions([{ title: 'Fix bug' }])).toBe('Fix bug')
  })
  it('names two', () => {
    expect(describeSessions([{ title: 'A' }, { title: 'B' }])).toBe('A, B')
  })
  it('collapses three or more', () => {
    expect(describeSessions([{ title: 'A' }, { title: 'B' }, { title: 'C' }])).toBe('A and 2 more')
  })
})

describe('non-colour state signals', () => {
  it('gives every file status a distinct letter', () => {
    const marks = (['added', 'deleted', 'modified', 'renamed'] as const).map(statusMark)
    expect(marks).toEqual(['A', 'D', 'M', 'R'])
    expect(new Set(marks).size).toBe(4)
  })

  it('gives every file status a word for assistive tech', () => {
    expect(statusLabel('added')).toBe('added')
    expect(statusLabel('renamed')).toBe('renamed')
  })

  it('marks add and delete lines distinctly from context', () => {
    expect(lineMark('add')).toBe('+')
    expect(lineMark('del')).toBe('-')
    expect(lineMark('context')).toBe(' ')
  })
})

describe('lineNumberWidth', () => {
  const file = (nums: (number | null)[]): { hunks: { lines: { oldLine: number | null; newLine: number | null }[] }[] } => ({
    hunks: [{ lines: nums.map((n) => ({ oldLine: n, newLine: n })) }]
  })

  it('never goes below two columns', () => {
    expect(lineNumberWidth([file([1, 2])])).toBe(2)
  })
  it('widens to the largest line number present', () => {
    expect(lineNumberWidth([file([9, 1204])])).toBe(4)
  })
  it('ignores nulls from one-sided lines', () => {
    expect(lineNumberWidth([file([null, 7])])).toBe(2)
  })
  it('is two for an empty diff', () => {
    expect(lineNumberWidth([])).toBe(2)
  })
})
