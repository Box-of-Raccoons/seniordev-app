import { describe, it, expect, vi } from 'vitest'
import { parseStartupArgs } from './parse-args'

const noRead = () => { throw new Error('should not read') }

describe('parseStartupArgs', () => {
  it('collects ticket positionals (uppercased) and ignores argv noise', () => {
    const o = parseStartupArgs(['C:/electron.exe', 'proj-12', 'AB-3', '/some/path', '--flagless'], noRead)
    expect(o.tickets).toEqual(['PROJ-12', 'AB-3'])
    expect(o.session).toBeUndefined()
  })
  it('parses --yolo <name> into a yolo session', () => {
    const o = parseStartupArgs(['PROJ-1', '--yolo', 'fix-bug'], noRead)
    expect(o.tickets).toEqual(['PROJ-1'])
    expect(o.session).toEqual({ mode: 'yolo', promptName: 'fix-bug', promptText: undefined, tool: undefined })
  })
  it('parses --prompt inline text as an interactive session', () => {
    const o = parseStartupArgs(['--prompt', 'do the thing'], noRead)
    expect(o.session?.mode).toBe('interactive')
    expect(o.session?.promptText).toBe('do the thing')
  })
  it('reads --prompt @file via the injected reader', () => {
    const read = vi.fn(() => 'FILE BODY')
    const o = parseStartupArgs(['--prompt', '@C:/p.md'], read)
    expect(read).toHaveBeenCalledWith('C:/p.md')
    expect(o.session?.promptText).toBe('FILE BODY')
  })
  it('parses --tool and --interactive', () => {
    const o = parseStartupArgs(['PROJ-9', '--interactive', '--tool', 'codex'], noRead)
    expect(o.session).toEqual({ mode: 'interactive', promptName: undefined, promptText: undefined, tool: 'codex' })
  })
  it('--yolo without a prompt name does not swallow the next flag', () => {
    const o = parseStartupArgs(['--yolo', '--tool', 'codex'], noRead)
    expect(o.session).toEqual({ mode: 'yolo', promptName: undefined, promptText: undefined, tool: 'codex' })
  })
  it('--yolo does not swallow a ticket key', () => {
    const o = parseStartupArgs(['PROJ-1', '--yolo', 'PROJ-2'], noRead)
    expect(o.tickets).toEqual(['PROJ-1', 'PROJ-2'])
    expect(o.session?.mode).toBe('yolo')
    expect(o.session?.promptName).toBeUndefined()
  })
  it('returns a session with promptText undefined and a warning when @file is missing', () => {
    const read = vi.fn(() => { throw new Error('ENOENT: no such file') })
    const o = parseStartupArgs(['--prompt', '@C:/missing.md'], read)
    expect(o.session).toBeDefined()
    expect(o.session?.promptText).toBeUndefined()
    expect(o.warnings).toHaveLength(1)
    expect(o.warnings![0]).toContain('C:/missing.md')
  })

  it('accepts the --prompt=value (equals) form', () => {
    const o = parseStartupArgs(['--prompt=hello from the CLI'], noRead)
    expect(o.session?.mode).toBe('interactive')
    expect(o.session?.promptText).toBe('hello from the CLI')
  })

  it('accepts --tool=value and --prompt=@file (equals form)', () => {
    const read = vi.fn(() => 'FILE BODY')
    const o = parseStartupArgs(['--tool=codex', '--prompt=@C:/p.md'], read)
    expect(read).toHaveBeenCalledWith('C:/p.md')
    expect(o.session).toEqual({ mode: 'interactive', promptName: undefined, promptText: 'FILE BODY', tool: 'codex' })
  })

  it('an =form --prompt survives Chromium argv reordering (a switch inserted after the flag)', () => {
    // The exact shape Electron delivered for `electron . --prompt "x"`: it clustered
    // its own switch right after --prompt and pushed the value/app-path to the end,
    // so the space form grabbed the switch as the prompt. The equals form keeps the
    // value welded to the flag regardless of order.
    const o = parseStartupArgs(['--prompt=hello from the CLI', '--allow-file-access-from-files', '.'], noRead)
    expect(o.session?.promptText).toBe('hello from the CLI')
  })

  it('--role=name keeps interactive mode (unlike --yolo, which forces yolo)', () => {
    const read = vi.fn(() => 'spoken task')
    const o = parseStartupArgs(['--role=orchestrator', '--prompt=@C:/t.txt'], read)
    expect(o.session).toEqual({ mode: 'interactive', promptName: 'orchestrator', promptText: 'spoken task', tool: undefined })
  })

  it('--role composes with --yolo and a ticket positional', () => {
    const o = parseStartupArgs(['SD-20', '--yolo', '--role=orchestrator', '--prompt=fix it'], noRead)
    expect(o.tickets).toEqual(['SD-20'])
    expect(o.session).toEqual({ mode: 'yolo', promptName: 'orchestrator', promptText: 'fix it', tool: undefined })
  })

  it('parses --folder onto the session (the trusted working dir)', () => {
    const o = parseStartupArgs(['--prompt=go', '--folder=C:/Users/hardy/code/x'], noRead)
    expect(o.session?.folder).toBe('C:/Users/hardy/code/x')
  })

  it('omits folder when not given (no stray key)', () => {
    const o = parseStartupArgs(['--prompt=go'], noRead)
    expect(o.session).not.toHaveProperty('folder')
  })
})
