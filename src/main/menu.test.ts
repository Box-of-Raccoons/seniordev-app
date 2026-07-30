import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getName: () => 'SeniorDev', getVersion: () => '0.0.0' },
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() }
}))

import { menuTemplate } from './menu'
import type { MenuAction } from '../shared/ipc'

type Item = { label?: string; role?: string; accelerator?: string; click?: () => void; submenu?: Item[]; type?: string }

describe('menuTemplate', () => {
  const sent: MenuAction[] = []
  const tpl = menuTemplate((a) => sent.push(a)) as Item[]

  it('has exactly File, Edit(role), Panes, Config, About', () => {
    expect(tpl.map((m) => m.label ?? m.role)).toEqual(['File', 'editMenu', 'Panes', 'Config', 'About'])
  })
  it('dev mode appends a View menu with DevTools', () => {
    const devTpl = menuTemplate(() => {}, true) as Item[]
    expect(devTpl.map((m) => m.label ?? m.role)).toEqual(['File', 'editMenu', 'Panes', 'Config', 'About', 'View'])
    expect(devTpl[5].submenu!.map((i) => i.role)).toEqual(['toggleDevTools', 'reload'])
  })
  it('Panes: clicking the items fires move-tab-left / move-tab-right', () => {
    const panes = tpl[2].submenu!
    // No native accelerator: the keyboard binding is a capture-phase handler in
    // the renderer (a menu accelerator loses to a focused xterm). Items stay as
    // focus-independent mouse actions.
    expect(panes.map((i) => i.accelerator)).toEqual([undefined, undefined])
    panes[0].click!()
    panes[1].click!()
    expect(sent).toEqual(expect.arrayContaining(['move-tab-left', 'move-tab-right']))
  })
  it('File: New Session (CmdOrCtrl+N) fires new-session; Exit is the quit role labeled Exit', () => {
    const file = tpl[0].submenu!
    expect(file[0].label).toBe('New Session')
    expect(file[0].accelerator).toBe('CmdOrCtrl+N')
    file[0].click!()
    expect(sent).toContain('new-session')
    expect(file[1].type).toBe('separator')
    expect(file[2].role).toBe('quit')
    expect(file[2].label).toBe('Exit')
  })
  it('Config items fire app-config and prompt-config', () => {
    const cfg = tpl[3].submenu!
    cfg[0].click!()
    cfg[1].click!()
    expect(sent).toEqual(expect.arrayContaining(['app-config', 'prompt-config']))
  })
  it('About fires about', () => {
    tpl[4].submenu![0].click!()
    expect(sent).toContain('about')
  })
})
