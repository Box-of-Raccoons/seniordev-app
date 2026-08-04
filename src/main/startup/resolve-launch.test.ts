import { describe, it, expect, vi } from 'vitest'
import { resolveSecondInstance } from './resolve-launch'

const noRead = () => { throw new Error('should not read') }
// argv arrives with the exe as argv[0] (Electron second-instance), matching the
// cold-start `process.argv` shape that parseStartupArgs slices off.
const EXE = 'C:/seniordev.exe'

describe('resolveSecondInstance', () => {
  it('--prompt text → a warm interactive session (auto-start, no ticket)', () => {
    const a = resolveSecondInstance([EXE, '--prompt', 'do the thing'], noRead)
    expect(a.kind).toBe('session')
    if (a.kind !== 'session') return
    expect(a.warm.session).toEqual({ mode: 'interactive', promptName: undefined, promptText: 'do the thing', tool: undefined })
    expect(a.warm.ticket).toBeUndefined()
    expect(a.warnings).toEqual([])
  })

  it('carries the first ticket alongside a --prompt session', () => {
    const a = resolveSecondInstance([EXE, '--prompt', 'fix it', 'PROJ-1'], noRead)
    expect(a).toMatchObject({ kind: 'session', warm: { ticket: 'PROJ-1' } })
    if (a.kind === 'session') expect(a.warm.session.promptText).toBe('fix it')
  })

  it('--tool sets the session tool', () => {
    const a = resolveSecondInstance([EXE, '--tool', 'claude', '--prompt', 'go'], noRead)
    expect(a.kind).toBe('session')
    if (a.kind === 'session') expect(a.warm.session.tool).toBe('claude')
  })

  it('--yolo <role> <ticket> → a warm yolo session', () => {
    const a = resolveSecondInstance([EXE, '--yolo', 'fix-bug', 'PROJ-2'], noRead)
    expect(a).toMatchObject({
      kind: 'session',
      warm: { session: { mode: 'yolo', promptName: 'fix-bug' }, ticket: 'PROJ-2' }
    })
  })

  it('reads --prompt @file through the injected reader', () => {
    const read = vi.fn(() => 'FILE BODY')
    const a = resolveSecondInstance([EXE, '--prompt', '@C:/p.txt'], read)
    expect(read).toHaveBeenCalledWith('C:/p.txt')
    if (a.kind === 'session') expect(a.warm.session.promptText).toBe('FILE BODY')
  })

  it('surfaces a warning (and still a session) when @file is missing', () => {
    const read = vi.fn(() => { throw new Error('ENOENT') })
    const a = resolveSecondInstance([EXE, '--prompt', '@C:/missing.txt'], read)
    expect(a.kind).toBe('session')
    if (a.kind !== 'session') return
    expect(a.warm.session.promptText).toBeUndefined()
    expect(a.warnings).toHaveLength(1)
    expect(a.warnings[0]).toContain('C:/missing.txt')
  })

  it('a bare ticket key (no session flags) → links, not a session', () => {
    const a = resolveSecondInstance([EXE, 'PROJ-3'], noRead)
    expect(a).toEqual({ kind: 'links', links: [{ action: 'open', ticket: 'PROJ-3' }] })
  })

  it('a seniordev:// deep link → links (prefill path, unchanged)', () => {
    const a = resolveSecondInstance([EXE, 'seniordev://open?ticket=SD-6'], noRead)
    expect(a).toEqual({ kind: 'links', links: [{ action: 'open', ticket: 'SD-6' }] })
  })

  it('no actionable args → empty links', () => {
    expect(resolveSecondInstance([EXE], noRead)).toEqual({ kind: 'links', links: [] })
  })

  it('an =form --prompt survives Electron argv reordering (the real second-instance shape)', () => {
    // Regression: `electron . --prompt "hello from the CLI"` reached second-instance
    // reordered as below — Electron clustered its own switch after --prompt and moved
    // the app path to the end, so the space form delivered the switch as the prompt.
    // The =form the sidecar now emits welds the value to the flag.
    const argv = ['C:/electron.exe', '--prompt=hello from the CLI', '--allow-file-access-from-files', '.']
    const a = resolveSecondInstance(argv, noRead)
    expect(a).toMatchObject({ kind: 'session', warm: { session: { promptText: 'hello from the CLI' } } })
  })
})
