import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ReviewView from './ReviewView.vue'
import type { ReviewTreeInfo, ReviewDiffInfo } from '../../../shared/ipc'

const tree = (over: Partial<ReviewTreeInfo> = {}): ReviewTreeInfo => ({
  cwd: '/code/app',
  branch: 'feature/x',
  sessions: [{ conversationId: 'c1', title: 'Fix the thing', tool: 'claude' }],
  files: 1,
  insertions: 3,
  deletions: 1,
  entries: [{ path: 'src/a.ts', insertions: 3, deletions: 1, binary: false, untracked: false }],
  untrackedTruncated: 0,
  error: null,
  ...over
})

const DIFF: ReviewDiffInfo = {
  files: [
    {
      path: 'src/a.ts',
      oldPath: null,
      status: 'modified',
      binary: false,
      insertions: 1,
      deletions: 1,
      hunks: [
        {
          header: '@@ -1,2 +1,2 @@',
          lines: [
            { kind: 'context', text: 'keep', oldLine: 1, newLine: 1 },
            { kind: 'del', text: 'old', oldLine: 2, newLine: null },
            { kind: 'add', text: 'new', oldLine: null, newLine: 2 }
          ]
        }
      ]
    }
  ],
  error: null
}

function stubApi(over?: { list?: ReviewTreeInfo[]; diff?: ReviewDiffInfo; listThrows?: Error }): {
  listReview: ReturnType<typeof vi.fn>
  reviewDiff: ReturnType<typeof vi.fn>
} {
  const api = {
    listReview: vi.fn(async () => {
      if (over?.listThrows) throw over.listThrows
      return over?.list ?? [tree()]
    }),
    reviewDiff: vi.fn(async () => over?.diff ?? DIFF)
  }
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = api
  return api
}

beforeEach(() => {
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = {}
})

describe('ReviewView', () => {
  it('lists every tree with pending changes on mount', async () => {
    stubApi({ list: [tree(), tree({ cwd: '/code/other', sessions: [] })] })
    const w = mount(ReviewView)
    await flushPromises()
    expect(w.findAll('.rv-tree')).toHaveLength(2)
    expect(w.text()).toContain('app')
    expect(w.text()).toContain('other')
  })

  it('says so plainly when nothing is uncommitted', async () => {
    stubApi({ list: [] })
    const w = mount(ReviewView)
    await flushPromises()
    expect(w.find('.rv-empty').text()).toMatch(/nothing uncommitted/i)
  })

  it('shows a tree git could not read as unreadable, not as clean', async () => {
    stubApi({ list: [tree({ error: 'fatal: not a git repository', files: 0 })] })
    const w = mount(ReviewView)
    await flushPromises()
    expect(w.find('.rv-bad').text()).toMatch(/not a git repository/i)
  })

  it('opens a tree and asks for its whole diff', async () => {
    const api = stubApi()
    const w = mount(ReviewView)
    await flushPromises()
    await w.find('.rv-tree').trigger('click')
    await flushPromises()
    expect(api.reviewDiff).toHaveBeenCalledWith('/code/app', null)
    expect(w.find('.rv-files').exists()).toBe(true)
  })

  it('scopes the diff to one file when a file row is clicked', async () => {
    const api = stubApi()
    const w = mount(ReviewView)
    await flushPromises()
    await w.find('.rv-tree').trigger('click')
    await flushPromises()
    await w.find('.rv-file').trigger('click')
    await flushPromises()
    expect(api.reviewDiff).toHaveBeenLastCalledWith('/code/app', 'src/a.ts')
  })

  it('renders every diff line with a +/- sign, so state is never colour-only', async () => {
    stubApi()
    const w = mount(ReviewView)
    await flushPromises()
    await w.find('.rv-tree').trigger('click')
    await flushPromises()
    const signs = w.findAll('.rv-line').map((l) => l.find('.rv-sign').text())
    expect(signs).toEqual(['', '-', '+'])
  })

  it('labels the file status with a letter and a word, not just a colour', async () => {
    stubApi()
    const w = mount(ReviewView)
    await flushPromises()
    await w.find('.rv-tree').trigger('click')
    await flushPromises()
    const mark = w.find('.rv-mark')
    expect(mark.text()).toBe('M')
    expect(mark.attributes('aria-label')).toBe('modified')
  })

  it('shows both line numbers for a context line and one for a changed line', async () => {
    stubApi()
    const w = mount(ReviewView)
    await flushPromises()
    await w.find('.rv-tree').trigger('click')
    await flushPromises()
    const nums = w.findAll('.rv-line').map((l) => l.findAll('.rv-num').map((n) => n.text()))
    expect(nums).toEqual([
      ['1', '1'],
      ['2', ''],
      ['', '2']
    ])
  })

  it('says "not counted" rather than "+0" for a file whose lines were not counted', async () => {
    // A 10MB migration rendering as "+0" reads as trivial. This is the third
    // state: not binary, not empty, just not counted.
    stubApi({
      list: [
        tree({
          entries: [
            { path: 'huge.sql', insertions: 0, deletions: 0, binary: false, untracked: true, uncounted: true }
          ]
        })
      ]
    })
    const w = mount(ReviewView)
    await flushPromises()
    await w.find('.rv-tree').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('not counted')
    expect(w.find('.rv-stat').exists()).toBe(false)
  })

  it('still shows +0 for a genuinely empty file', async () => {
    stubApi({
      list: [
        tree({
          entries: [{ path: 'empty.txt', insertions: 0, deletions: 0, binary: false, untracked: true }]
        })
      ]
    })
    const w = mount(ReviewView)
    await flushPromises()
    await w.find('.rv-tree').trigger('click')
    await flushPromises()
    expect(w.find('.rv-stat').text()).toContain('+0')
    expect(w.text()).not.toContain('not counted')
  })

  it('marks an untracked entry as new', async () => {
    stubApi({
      list: [tree({ entries: [{ path: 'src/new.ts', insertions: 5, deletions: 0, binary: false, untracked: true }] })]
    })
    const w = mount(ReviewView)
    await flushPromises()
    await w.find('.rv-tree').trigger('click')
    await flushPromises()
    expect(w.find('.rv-new').text()).toBe('new')
  })

  it('reports how many untracked files were past the scan cap', async () => {
    stubApi({ list: [tree({ untrackedTruncated: 7 })] })
    const w = mount(ReviewView)
    await flushPromises()
    await w.find('.rv-tree').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('7 further untracked files not listed')
  })

  it('goes back to the overview', async () => {
    stubApi()
    const w = mount(ReviewView)
    await flushPromises()
    await w.find('.rv-tree').trigger('click')
    await flushPromises()
    await w.find('.ghost').trigger('click')
    await flushPromises()
    expect(w.find('.rv-trees').exists()).toBe(true)
  })

  it('surfaces a failed list rather than rendering an empty review', async () => {
    stubApi({ listThrows: new Error('ipc exploded') })
    const w = mount(ReviewView)
    await flushPromises()
    expect(w.find('.rv-error').text()).toContain('ipc exploded')
  })

  it('offers exactly one primary (teal) action, per the One Signal Rule', async () => {
    stubApi()
    const w = mount(ReviewView)
    await flushPromises()
    expect(w.findAll('.primary')).toHaveLength(1)
  })
})
