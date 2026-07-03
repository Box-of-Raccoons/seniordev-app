import { Menu, type MenuItemConstructorOptions } from 'electron'
import { MENU, type MenuAction } from '../shared/ipc'

// The menu is deliberately dumb: every item only sends one IPC action to the
// focused window; the renderer owns all behavior (modals, reset flow).
export function menuTemplate(send: (action: MenuAction) => void): MenuItemConstructorOptions[] {
  return [
    {
      label: 'File',
      submenu: [
        { label: 'New Session', accelerator: 'CmdOrCtrl+N', click: () => send('new-session') },
        { type: 'separator' },
        // Without an Edit role-menu below, clipboard accelerators die on macOS.
        { role: 'quit', label: 'Exit' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'Config',
      submenu: [
        { label: 'App Config…', click: () => send('app-config') },
        { label: 'Prompt Config…', click: () => send('prompt-config') }
      ]
    },
    {
      label: 'About',
      submenu: [{ label: 'About SeniorDev', click: () => send('about') }]
    }
  ]
}

export function installMenu(getSender: () => Electron.WebContents | undefined): void {
  const send = (action: MenuAction): void => getSender()?.send(MENU.action, action)
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate(send)))
}
