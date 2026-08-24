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
  // Identified by label/role rather than by index: File now grows in the middle
  // (Review Changes sits with the other actions, above the separator), and a
  // positional assertion would fail every time a legitimate item is added there.
  it('File: New Session (CmdOrCtrl+N) fires new-session; Exit is the quit role labeled Exit', () => {
    const file = tpl[0].submenu!
    const newSession = file.find((i) => i.label === 'New Session')!
    expect(newSession.accelerator).toBe('CmdOrCtrl+N')
    newSession.click!()
    expect(sent).toContain('new-session')
    expect(file.some((i) => i.type === 'separator')).toBe(true)
    const quit = file.find((i) => i.role === 'quit')!
    expect(quit.label).toBe('Exit')
  })

  it('File: Review Changes fires review and sits above the separator', () => {
    const file = tpl[0].submenu!
    const review = file.find((i) => i.label === 'Review Changes')!
    // Not plain CmdOrCtrl+R: that is the dev View menu's reload role, and File
    // is matched first, so a plain R would take reload away in dev.
    expect(review.accelerator).toBe('CmdOrCtrl+Shift+R')
    review.click!()
    expect(sent).toContain('review')
    // An action, so it belongs with the actions rather than below the quit rule.
    expect(file.indexOf(review)).toBeLessThan(file.findIndex((i) => i.type === 'separator'))
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

describe('menuTemplate — schedules', () => {
  it('offers Schedules without displacing the existing Config items', () => {
    // The existing Config assertions index positionally, so this entry goes last:
    // adding a menu item must not renumber the ones already there.
    const sent: MenuAction[] = []
    const cfg = menuTemplate((a) => sent.push(a)).find((m) => m.label === 'Config')
      ?.submenu as Electron.MenuItemConstructorOptions[]
    const item = cfg.find((m) => m.label === 'Schedules…')
    expect(item).toBeDefined()
    expect(cfg.indexOf(item!)).toBe(cfg.length - 1)
    item!.click?.(undefined as never, undefined, undefined as never)
    expect(sent).toEqual(['schedules'])
  })
})
