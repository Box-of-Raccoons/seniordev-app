import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import WorktreeTeardownDialog from './WorktreeTeardownDialog.vue'

describe('WorktreeTeardownDialog', () => {
  it('offers the worktree-removal checkbox only when a worktree exists', () => {
    const without = mount(WorktreeTeardownDialog, { props: { title: 'Archive?' } })
    expect(without.find('.wt-remove').exists()).toBe(false)
    const withWt = mount(WorktreeTeardownDialog, { props: { title: 'Archive?', worktreePath: '/wt/x' } })
    expect(withWt.find('.wt-remove').exists()).toBe(true)
    expect(withWt.text()).toContain('/wt/x')
  })

  it('emits confirm with removeWorktree:false by default (never destroy a diff by default)', async () => {
    const w = mount(WorktreeTeardownDialog, { props: { title: 'Archive?', worktreePath: '/wt/x' } })
    await w.find('.btn-yes').trigger('click')
    expect(w.emitted('confirm')?.[0]?.[0]).toEqual({ removeWorktree: false, dontAskAgain: false })
  })

  it('emits confirm with removeWorktree:true when the checkbox is ticked', async () => {
    const w = mount(WorktreeTeardownDialog, { props: { title: 'Archive?', worktreePath: '/wt/x' } })
    await w.find('.wt-remove input').setValue(true)
    await w.find('.btn-yes').trigger('click')
    expect(w.emitted('confirm')?.[0]?.[0]).toEqual({ removeWorktree: true, dontAskAgain: false })
  })

  it('S7: "Don\'t ask again" is offered only for a no-worktree archive and rides the confirm', async () => {
    const withWt = mount(WorktreeTeardownDialog, { props: { title: 'Archive?', worktreePath: '/wt/x' } })
    expect(withWt.find('.dont-ask').exists()).toBe(false) // worktree teardowns always confirm
    const noWt = mount(WorktreeTeardownDialog, { props: { title: 'Archive?' } })
    expect(noWt.find('.dont-ask').exists()).toBe(true)
    await noWt.find('.dont-ask input').setValue(true)
    await noWt.find('.btn-yes').trigger('click')
    expect(noWt.emitted('confirm')?.[0]?.[0]).toEqual({ removeWorktree: false, dontAskAgain: true })
  })

  it('renders a removal failure and switches the cancel label to Close', () => {
    const w = mount(WorktreeTeardownDialog, {
      props: { title: 'Archive?', worktreePath: '/wt/x', failure: 'worktree has uncommitted changes; not removed' }
    })
    expect(w.text()).toContain('Worktree not removed: worktree has uncommitted changes; not removed')
    expect(w.find('.btn-no').text()).toBe('Close')
  })

  it('emits cancel from the cancel button', async () => {
    const w = mount(WorktreeTeardownDialog, { props: { title: 'Archive?' } })
    await w.find('.btn-no').trigger('click')
    expect(w.emitted('cancel')).toHaveLength(1)
  })
})
