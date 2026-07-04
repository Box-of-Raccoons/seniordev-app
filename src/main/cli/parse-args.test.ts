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
  it('parses --orchestrate <ticket> (uppercased) without consuming it as a positional', () => {
    const o = parseStartupArgs(['--orchestrate', 'sd-6'], noRead)
    expect(o.orchestrate).toBe('SD-6')
    expect(o.tickets).toEqual([])   // the key belongs to the flag, not positionals
    expect(o.session).toBeUndefined()
  })
  it('warns when --orchestrate is missing a ticket key', () => {
    const o = parseStartupArgs(['--orchestrate', '--minimized'], noRead)
    expect(o.orchestrate).toBeUndefined()
    expect(o.warnings?.[0]).toContain('--orchestrate requires a ticket key')
  })
  it('parses --minimized', () => {
    const o = parseStartupArgs(['--orchestrate', 'SD-6', '--minimized'], noRead)
    expect(o.orchestrate).toBe('SD-6')
    expect(o.minimized).toBe(true)
  })
  it('omits orchestrate/minimized when not passed', () => {
    const o = parseStartupArgs(['PROJ-1'], noRead)
    expect(o.orchestrate).toBeUndefined()
    expect(o.minimized).toBeUndefined()
  })
})
