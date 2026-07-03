import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import { MENU, type MenuAction } from '../shared/ipc'

// The menu is deliberately dumb: every item only sends one IPC action to the
// focused window; the renderer owns all behavior (modals, reset flow).
// `dev` appends a View menu (DevTools/reload) — replacing the default menu
// otherwise removes the F12/Ctrl+Shift+I accelerators entirely.
export function menuTemplate(send: (action: MenuAction) => void, dev = false): MenuItemConstructorOptions[] {
  const view: MenuItemConstructorOptions[] = dev
    ? [{ label: 'View', submenu: [{ role: 'toggleDevTools' }, { role: 'reload' }] }]
    : []
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
    },
    ...view
  ]
}

export function installMenu(getSender: () => Electron.WebContents | undefined): void {
  const send = (action: MenuAction): void => getSender()?.send(MENU.action, action)
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate(send, !app.isPackaged)))
}
