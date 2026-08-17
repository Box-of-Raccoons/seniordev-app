import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import Composer from './Composer.vue'

const resolveRepo = vi.fn(async () => ({ key: 'SD', path: 'C:/repos/sd', tool: 'claude' }))

beforeEach(() => {
  resolveRepo.mockClear()
  ;(window as unknown as { api: unknown }).api = {
    listPrompts: vi.fn(async () => [
      { name: 'orchestrator', description: 'default' },
      { name: 'senior-dev', description: 'build it' }
    ]),
    listRepos: vi.fn(async () => [{ key: 'SD', path: 'C:/repos/sd' }]),
    listRecentFolders: vi.fn(async () => []),
    listShells: vi.fn(async () => ({ shells: ['pwsh', 'cmd'], default: 'pwsh' })),
    listTools: vi.fn(async () => ['claude', 'codex']),
    resolveRepo,
    yoloCaps: vi.fn(async () => ({ available: true })),
    // S5: default to "not a git repo" so the worktree control is inert unless a
    // test opts in; createWorktree succeeds by default.
    worktreeInfo: vi.fn(async () => ({ isRepo: false, branchPrefix: '', worktreeDefault: false })),
    createWorktree: vi.fn(async () => ({ ok: true, worktreePath: '/wt/x', branch: 'feat' }))
  }
})

async function mountComposer(variant: 'agent' | 'terminal' = 'agent', tool = 'claude') {
  const w = mount(Composer, { props: { variant, tool } })
  await flushPromises()
  return w
}

describe('Composer', () => {
  it('defaults the role to orchestrator when present', async () => {
    const w = await mountComposer()
    expect((w.find('#composer-role').element as HTMLSelectElement).value).toBe('orchestrator')
  })

  it('detects a ticket key vs free text and shows the right hint', async () => {
    const w = await mountComposer()
    await w.find('#composer-input').setValue('isc-835')
    expect(w.text()).toContain('detected ticket ISC-835')
    await w.find('#composer-input').setValue('document the CICD process')
    expect(w.text()).toContain('free text')
  })

  it('agent variant shows role + a multi-line input, no shell', async () => {
    const w = await mountComposer('agent')
    expect(w.find('#composer-role').exists()).toBe(true)
    expect(w.find('#composer-input').element.tagName).toBe('TEXTAREA')
    expect(w.find('#composer-shell').exists()).toBe(false)
  })

  it('terminal variant shows only a shell picker, no role/input', async () => {
    const w = await mountComposer('terminal')
    expect(w.find('#composer-role').exists()).toBe(false)
    expect(w.find('#composer-input').exists()).toBe(false)
    expect(w.find('#composer-shell').exists()).toBe(true)
  })

  it('requires a folder before launch is enabled', async () => {
    const w = await mountComposer()
    expect((w.find('button[type="submit"]').element as HTMLButtonElement).disabled).toBe(true)
    await w.find('#composer-folder').setValue('C:/x')
    expect((w.find('button[type="submit"]').element as HTMLButtonElement).disabled).toBe(false)
  })

  it('emits an interactive launch with role, input, ticket key, and tool', async () => {
    const w = await mountComposer('agent', 'claude')
    await w.find('#composer-folder').setValue('C:/work')
    await w.find('#composer-input').setValue('ISC-835')
    await w.find('form').trigger('submit')
    expect(w.emitted('launch')?.[0]?.[0]).toMatchObject({
      mode: 'interactive',
      folder: 'C:/work',
      role: 'orchestrator',
      input: 'ISC-835',
      ticketKey: 'ISC-835',
      yolo: false,
      tool: 'claude'
    })
  })

  it('relabels Launch to Launch YOLO and emits yolo:true when checked', async () => {
    const w = await mountComposer()
    await w.find('#composer-folder').setValue('C:/work')
    await w.find('.yolo input').setValue(true)
    expect(w.find('button[type="submit"]').text()).toBe('Launch YOLO')
    await w.find('form').trigger('submit')
    expect(w.emitted('launch')?.[0]?.[0]).toMatchObject({ yolo: true })
  })

  it('emits a terminal launch with the chosen shell and no role', async () => {
    const w = await mountComposer('terminal')
    await w.find('#composer-folder').setValue('C:/proj')
    await w.find('form').trigger('submit')
    expect(w.emitted('launch')?.[0]?.[0]).toEqual({ mode: 'terminal', folder: 'C:/proj', shell: 'pwsh' })
  })

  it('prefills the folder from the ticket-mapped repo until the user edits it', async () => {
    const w = await mountComposer()
    await w.find('#composer-input').setValue('SD-42')
    await flushPromises()
    expect(resolveRepo).toHaveBeenCalledWith('SD-42')
    expect((w.find('#composer-folder').element as HTMLInputElement).value).toBe('C:/repos/sd')
  })

  it('does not overwrite a folder the user already chose', async () => {
    const w = await mountComposer()
    await w.find('#composer-folder').setValue('D:/mine')
    await w.find('#composer-input').setValue('SD-42')
    await flushPromises()
    expect((w.find('#composer-folder').element as HTMLInputElement).value).toBe('D:/mine')
  })

  it('agent shows a Claude|Codex tool picker and emits the chosen tool', async () => {
    const w = await mountComposer('agent')
    // The tool picker is the only segmented group now (the Task/Open toggle is gone).
    const toolSeg = w.find('.seg')
    expect(toolSeg.findAll('.seg-btn').map((b) => b.text())).toEqual(['Claude', 'Codex'])
    await w.find('#composer-folder').setValue('C:/work')
    await toolSeg.findAll('.seg-btn')[1].trigger('click')
    await w.find('form').trigger('submit')
    expect(w.emitted('launch')?.[0]?.[0]).toMatchObject({ tool: 'codex' })
  })

  it('is task-only: role, description and YOLO are always shown for an agent (no Task/Open toggle)', async () => {
    const w = await mountComposer('agent')
    expect(w.text()).not.toContain('Session mode')
    expect(w.find('#composer-role').exists()).toBe(true)
    expect(w.find('#composer-input').exists()).toBe(true)
    expect(w.find('.yolo').exists()).toBe(true)
  })

  it('renders recent-folder chips (basename) and fills the folder when one is clicked', async () => {
    ;(window.api as unknown as { listRecentFolders: unknown }).listRecentFolders = vi.fn(async () => [
      'C:/code/seniordev-app'
    ])
    const w = mount(Composer, { props: { variant: 'agent', tool: 'claude' } })
    await flushPromises()
    const recent = w.find('[aria-label="Recent folders"]')
    expect(recent.exists()).toBe(true)
    const chip = recent.find('.chip')
    expect(chip.text()).toBe('seniordev-app')
    await chip.trigger('click')
    expect((w.find('#composer-folder').element as HTMLInputElement).value).toBe('C:/code/seniordev-app')
  })

  // --- S5 worktree toggle (Task mode only) ---

  function setWtInfo(info: { isRepo: boolean; branchPrefix?: string; worktreeDefault?: boolean }): void {
    ;(window.api as unknown as { worktreeInfo: unknown }).worktreeInfo = vi.fn(async () => ({
      isRepo: info.isRepo,
      branchPrefix: info.branchPrefix ?? '',
      worktreeDefault: info.worktreeDefault ?? false
    }))
  }
  async function mountWithFolder(): Promise<ReturnType<typeof mount>> {
    const w = mount(Composer, { props: { variant: 'agent', tool: 'claude', initialFolder: 'C:/repo' } })
    await flushPromises()
    return w
  }

  it('worktree checkbox is disabled with a reason on a non-git folder', async () => {
    setWtInfo({ isRepo: false })
    const w = await mountWithFolder()
    const box = w.find('.wt-check input')
    expect(box.exists()).toBe(true)
    expect((box.element as HTMLInputElement).disabled).toBe(true)
    expect(w.text()).toContain('not a git repository')
  })

  it('worktree checkbox enables on a git folder; branch prefills prefix + slug and stops after a manual edit', async () => {
    setWtInfo({ isRepo: true, branchPrefix: 'hardy/', worktreeDefault: true })
    const w = await mountWithFolder()
    await w.find('#composer-input').setValue('Add the widget')
    await flushPromises()
    const box = w.find('.wt-check input')
    expect((box.element as HTMLInputElement).disabled).toBe(false)
    // Auto-checked from worktreeDefault, so the branch field is visible.
    const branch = w.find('#composer-branch').element as HTMLInputElement
    expect(branch.value).toBe('hardy/add-the-widget')
    // A manual edit sticks; a later prompt change must not overwrite it.
    await w.find('#composer-branch').setValue('hardy/my-own')
    await w.find('#composer-input').setValue('something else entirely')
    await flushPromises()
    expect((w.find('#composer-branch').element as HTMLInputElement).value).toBe('hardy/my-own')
  })

  it('empty prefix + empty prompt falls the branch back to "task"', async () => {
    setWtInfo({ isRepo: true, branchPrefix: '', worktreeDefault: true })
    const w = await mountWithFolder()
    expect((w.find('#composer-branch').element as HTMLInputElement).value).toBe('task')
  })

  it('pre-flight create failure shows the reason and does NOT emit a launch', async () => {
    setWtInfo({ isRepo: true, branchPrefix: '', worktreeDefault: true })
    ;(window.api as unknown as { createWorktree: unknown }).createWorktree = vi.fn(async () => ({
      ok: false,
      error: "a branch named 'task' already exists"
    }))
    const w = await mountWithFolder()
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(w.emitted('launch')).toBeUndefined()
    expect(w.text()).toContain("a branch named 'task' already exists")
  })

  it('pre-flight create success emits worktreePath, branch, and worktreeChoice', async () => {
    setWtInfo({ isRepo: true, branchPrefix: 'hardy/', worktreeDefault: true })
    ;(window.api as unknown as { createWorktree: unknown }).createWorktree = vi.fn(async () => ({
      ok: true,
      worktreePath: '/cfg/worktrees/repo/hardy-thing',
      branch: 'hardy/thing'
    }))
    const w = await mountWithFolder()
    await w.find('#composer-input').setValue('thing')
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(w.emitted('launch')?.[0]?.[0]).toMatchObject({
      mode: 'interactive',
      worktreePath: '/cfg/worktrees/repo/hardy-thing',
      branch: 'hardy/thing',
      worktreeChoice: true
    })
  })

  it('worktree control shows for a git-repo agent launch, not for a terminal', async () => {
    setWtInfo({ isRepo: true, worktreeDefault: true })
    const agent = mount(Composer, { props: { variant: 'agent', tool: 'claude', initialFolder: 'C:/repo' } })
    await flushPromises()
    expect(agent.find('.wt-check').exists()).toBe(true)
    const term = mount(Composer, { props: { variant: 'terminal', initialFolder: 'C:/repo' } })
    await flushPromises()
    expect(term.find('.wt-check').exists()).toBe(false)
  })

  it('project-locked mode hides the folder picker, shows a project header, and still launches with the folder', async () => {
    setWtInfo({ isRepo: false })
    const w = mount(Composer, {
      props: { variant: 'agent', tool: 'claude', projectName: 'my-app', initialFolder: 'C:/code/my-app' }
    })
    await flushPromises()
    // No folder field; a read-only project header instead.
    expect(w.find('#composer-folder').exists()).toBe(false)
    expect(w.find('.proj-header__name').text()).toBe('my-app')
    // Launch is enabled (folder is pinned) and carries the project folder.
    await w.find('form').trigger('submit')
    expect(w.emitted('launch')?.[0]?.[0]).toMatchObject({ mode: 'interactive', folder: 'C:/code/my-app' })
  })

  it('non-locked mode still shows the folder field (regression guard)', async () => {
    const w = await mountComposer('agent')
    expect(w.find('#composer-folder').exists()).toBe(true)
    expect(w.find('.proj-header').exists()).toBe(false)
  })

  it('launches on Ctrl+Enter from the form', async () => {
    const w = await mountComposer('agent')
    await w.find('#composer-folder').setValue('C:/code/app')
    await w.find('form').trigger('keydown', { key: 'Enter', ctrlKey: true })
    expect(w.emitted('launch')?.[0]?.[0]).toMatchObject({ mode: 'interactive', folder: 'C:/code/app' })
  })
})

// Focus needs the component in the real document: jsdom only tracks
// document.activeElement for attached elements.
describe('Composer focus', () => {
  async function mountAttached(props: Record<string, unknown>) {
    const w = mount(Composer, { props: { variant: 'agent', tool: 'claude', ...props }, attachTo: document.body })
    await flushPromises()
    return w
  }

  it('focuses the task field when it opens as the active tab', async () => {
    const w = await mountAttached({ active: true })
    expect(document.activeElement).toBe(w.find('#composer-input').element)
    w.unmount()
  })

  it('focuses the folder field in terminal mode, which has no task field', async () => {
    const w = await mountAttached({ variant: 'terminal', active: true })
    expect(document.activeElement).toBe(w.find('#composer-folder').element)
    w.unmount()
  })

  it('does not steal focus while inactive, and takes it when the tab is switched to', async () => {
    const w = await mountAttached({ active: false })
    const field = w.find('#composer-input').element
    expect(document.activeElement).not.toBe(field)

    await w.setProps({ active: true })
    await flushPromises()
    expect(document.activeElement).toBe(field)
    w.unmount()
  })
})
