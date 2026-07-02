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
})
