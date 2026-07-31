import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import SubagentPanel from './SubagentPanel.vue'
import { useWorkspace } from '../composables/useWorkspace'
import { useSubagents, type SubagentApi } from '../composables/useSubagents'
import type { SubagentSpawnEvent, SubagentActivityEvent } from '../../../shared/ipc'

function fakeApi(): SubagentApi & { spawn: (e: SubagentSpawnEvent) => void; activity: (e: SubagentActivityEvent) => void } {
  const cbs: { spawn?: (e: SubagentSpawnEvent) => void; activity?: (e: SubagentActivityEvent) => void } = {}
  return {
    onSubagentSpawn: (cb) => ((cbs.spawn = cb), () => {}),
    onSubagentActivity: (cb) => ((cbs.activity = cb), () => {}),
    onSubagentDone: () => () => {},
    spawn: (e) => cbs.spawn?.(e),
    activity: (e) => cbs.activity?.(e)
  }
}

function setup() {
  const ws = useWorkspace()
  const api = fakeApi()
  const subagents = useSubagents({ api, now: () => 1000, tickMs: 100000 })
  subagents.start()
  const w = mount(SubagentPanel, { props: { subagents, ws } })
  return { ws, api, subagents, w }
}

describe('SubagentPanel', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('shows the empty state when nothing is running', () => {
    const { w } = setup()
    expect(w.find('.sp-empty').exists()).toBe(true)
    expect(w.find('.tile').exists()).toBe(false)
  })

  it('renders a tile with type, id, and its activity log', async () => {
    const { w, api } = setup()
    api.spawn({ session: 'p1', agent: 'agent-12345678', agentType: 'Explore', ts: 1000 })
    api.activity({ session: 'p1', agent: 'agent-12345678', kind: 'tool', tool: 'Read', target: '/a/b.ts', ts: 1000 })
    await w.vm.$nextTick()
    expect(w.find('.tile').exists()).toBe(true)
    expect(w.find('.tile-type').text()).toBe('Explore')
    expect(w.find('.tile-log').text()).toContain('▸ Read /a/b.ts')
    expect(w.find('.count').text()).toBe('1')
  })

  it('collapse control switches to the collapsed strip', async () => {
    const { w, ws } = setup()
    await w.find('[aria-label="Collapse subagents panel"]').trigger('click')
    expect(ws.subagentPanel.collapsed).toBe(true)
    expect(w.find('.sp-rail').exists()).toBe(true)
    // Expanding again restores the header.
    await w.find('[aria-label="Expand subagents panel"]').trigger('click')
    expect(ws.subagentPanel.collapsed).toBe(false)
    expect(w.find('.sp-head').exists()).toBe(true)
  })

  it('placement toggle flips right ⇄ bottom (persisted state)', async () => {
    const { w, ws } = setup()
    expect(ws.subagentPanel.placement).toBe('right')
    await w.find('[aria-label="Move panel to bottom"]').trigger('click')
    expect(ws.subagentPanel.placement).toBe('bottom')
  })

  it('the "this app" checkbox drives the persisted appOnly flag', async () => {
    const { w, ws } = setup()
    const box = w.find('.app-only input')
    await box.setValue(true)
    expect(ws.subagentPanel.appOnly).toBe(true)
  })
})
