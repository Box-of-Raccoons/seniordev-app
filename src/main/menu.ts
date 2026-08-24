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
        // Review spans every session, not one project, so it lives here rather
        // than in the sidebar's per-project launcher. Shift+R, not plain
        // CmdOrCtrl+R: the dev View menu's `reload` role owns that, and File is
        // matched first, so a plain R here would silently steal reload in dev.
        // Ctrl+D was the other mnemonic and is worse — it is EOF in a shell tab.
        { label: 'Review Changes', accelerator: 'CmdOrCtrl+Shift+R', click: () => send('review') },
        { type: 'separator' },
        // Without an Edit role-menu below, clipboard accelerators die on macOS.
        { role: 'quit', label: 'Exit' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'Panes',
      submenu: [
        // Move the active tab to the pane on either side, spilling into a new edge
        // column past the last pane. No accelerator here: a menu accelerator loses
        // to a focused xterm (which consumes the keydown), so the keyboard binding
        // lives in a capture-phase handler in the renderer (see App.vue). These
        // stay as focus-independent mouse actions and discoverability.
        { label: 'Move Tab to Left Pane (Cmd/Ctrl+Shift+Left)', click: () => send('move-tab-left') },
        { label: 'Move Tab to Right Pane (Cmd/Ctrl+Shift+Right)', click: () => send('move-tab-right') }
      ]
    },
    {
      label: 'Config',
      submenu: [
        { label: 'App Config…', click: () => send('app-config') },
        { label: 'Prompt Config…', click: () => send('prompt-config') },
        { type: 'separator' },
        { label: 'Schedules…', click: () => send('schedules') }
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
