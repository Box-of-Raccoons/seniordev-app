import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import SearchOverlay from './SearchOverlay.vue'
import type { SearchResultInfo } from '../../../shared/ipc'

const result = (over: Partial<SearchResultInfo> = {}): SearchResultInfo => ({
  hits: [
    {
      conversationId: 'c1',
      title: 'Fix the comparator',
      tool: 'claude',
      projectId: 'p1',
      cwd: '/repo',
      agentSessionId: 'sid',
      matches: [{ role: 'user', excerpt: 'fix the sync comparator today', offset: 13, turn: 1 }]
    }
  ],
  sessionsScanned: 4,
  sessionsSkipped: 0,
  hitsTruncated: false,
  ...over
})

function stubApi(res: SearchResultInfo | Error): ReturnType<typeof vi.fn> {
  const searchTranscripts = vi.fn(async () => {
    if (res instanceof Error) throw res
    return res
  })
  ;(window as unknown as { api: unknown }).api = { searchTranscripts }
  return searchTranscripts
}

async function open(res: SearchResultInfo | Error = result()) {
  const api = stubApi(res)
  const w = mount(SearchOverlay, { props: { open: true }, attachTo: document.body })
  await flushPromises()
  return { w, api }
}

async function search(w: Awaited<ReturnType<typeof open>>['w'], q = 'comparator') {
  await w.find('.q').setValue(q)
  await w.find('form').trigger('submit')
  await flushPromises()
}

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {}
})

describe('SearchOverlay', () => {
  it('renders nothing when closed', () => {
    stubApi(result())
    const w = mount(SearchOverlay, { props: { open: false } })
    expect(w.find('.palette').exists()).toBe(false)
  })

  it('does NOT search on every keystroke', async () => {
    // A scan opens transcript files; per-keystroke would be wasteful and slow.
    const { w, api } = await open()
    await w.find('.q').setValue('comp')
    await flushPromises()
    expect(api).not.toHaveBeenCalled()
  })

  it('searches on submit', async () => {
    const { w, api } = await open()
    await search(w)
    expect(api).toHaveBeenCalledWith('comparator')
  })

  it('refuses to search an empty query', async () => {
    const { w, api } = await open()
    await w.find('.q').setValue('   ')
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(api).not.toHaveBeenCalled()
  })

  it('lists a hit with its session title', async () => {
    const { w } = await open()
    await search(w)
    expect(w.find('.hit-title').text()).toBe('Fix the comparator')
  })

  it('LABELS each match with its role, so you can tell your words from the agent output', async () => {
    const { w } = await open()
    await search(w)
    expect(w.find('.m-role').text()).toBe('you')
  })

  it('labels an agent match distinctly', async () => {
    const { w } = await open(
      result({
        hits: [
          {
            ...result().hits[0],
            matches: [{ role: 'agent', excerpt: 'TypeError thrown', offset: 0, turn: 2 }]
          }
        ]
      })
    )
    await search(w, 'TypeError')
    expect(w.find('.m-role').text()).toBe('agent')
  })

  it('highlights the matched text', async () => {
    const { w } = await open()
    await search(w)
    expect(w.find('mark').text()).toBe('comparator')
  })

  it('says plainly when nothing matched, naming how many sessions it looked at', async () => {
    const { w } = await open(result({ hits: [], sessionsScanned: 12 }))
    await search(w)
    expect(w.find('.note').text()).toMatch(/Nothing found in 12 sessions/)
  })

  it('WARNS when the scan was capped, so a partial result never reads as complete', async () => {
    const { w } = await open(result({ sessionsSkipped: 40 }))
    await search(w)
    expect(w.text()).toMatch(/40 older sessions not searched/)
  })

  it('warns when more matches exist than are shown', async () => {
    const { w } = await open(result({ hitsTruncated: true }))
    await search(w)
    expect(w.text()).toMatch(/More matches exist/)
  })

  it('surfaces a failed search rather than showing an empty result', async () => {
    const { w } = await open(new Error('scan exploded'))
    await search(w)
    expect(w.find('.err').text()).toContain('scan exploded')
  })

  it('emits the picked hit', async () => {
    const { w } = await open()
    await search(w)
    await w.find('.hit').trigger('click')
    expect(w.emitted('pick')?.[0][0]).toMatchObject({ conversationId: 'c1' })
  })

  it('closes on a scrim click', async () => {
    const { w } = await open()
    await w.find('.scrim').trigger('click')
    expect(w.emitted('close')).toBeTruthy()
  })

  it('offers exactly one primary action, per the One Signal Rule', async () => {
    const { w } = await open()
    expect(w.findAll('.primary')).toHaveLength(1)
  })
})

// The overlay is modal in behaviour, so it needs modal focus semantics: a
// keyboard-first tool that drops focus to <body> on close leaves the next Tab
// starting from nowhere.
describe('SearchOverlay — modal focus semantics', () => {
  it('declares itself modal to assistive tech', async () => {
    const { w } = await open()
    expect(w.find('[role="dialog"]').attributes('aria-modal')).toBe('true')
  })

  it('moves focus into the input on open', async () => {
    const { w } = await open()
    expect(document.activeElement).toBe(w.find('.q').element)
  })

  it('RETURNS focus to whatever had it when the overlay closes', async () => {
    stubApi(result())
    const before = document.createElement('button')
    document.body.appendChild(before)
    before.focus()
    expect(document.activeElement).toBe(before)

    const w = mount(SearchOverlay, { props: { open: false }, attachTo: document.body })
    await w.setProps({ open: true })
    await flushPromises()
    expect(document.activeElement).not.toBe(before)

    await w.setProps({ open: false })
    await flushPromises()
    expect(document.activeElement).toBe(before)
    before.remove()
  })

  // A query is typed first because the Search button is disabled while the
  // query is empty, and a disabled control is not a tab stop — with an empty
  // query the input is the ONLY focusable element and correctly traps to itself.
  it('wraps Tab from the last control back to the first, rather than out of the dialog', async () => {
    const { w } = await open()
    await w.find('.q').setValue('anything')
    const last = w.find('.primary').element as HTMLElement
    last.focus()
    await w.find('.palette').trigger('keydown', { key: 'Tab' })
    expect(document.activeElement).toBe(w.find('.q').element)
  })

  it('wraps Shift+Tab from the first control back to the last', async () => {
    const { w } = await open()
    await w.find('.q').setValue('anything')
    ;(w.find('.q').element as HTMLElement).focus()
    await w.find('.palette').trigger('keydown', { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(w.find('.primary').element)
  })

  it('traps to the single control when the search button is disabled', async () => {
    const { w } = await open()
    ;(w.find('.q').element as HTMLElement).focus()
    await w.find('.palette').trigger('keydown', { key: 'Tab' })
    // Nowhere else to go, so focus stays put rather than escaping the dialog.
    expect(document.activeElement).toBe(w.find('.q').element)
  })
})
