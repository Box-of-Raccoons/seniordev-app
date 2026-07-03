import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { configDir } from './paths'

describe('configDir', () => {
  it('win32 with APPDATA set', () => {
    const result = configDir('win32', { APPDATA: 'C:\\Users\\user\\AppData\\Roaming' }, 'C:\\Users\\user')
    expect(result).toBe(join('C:\\Users\\user\\AppData\\Roaming', 'SeniorDev'))
  })
  it('win32 without APPDATA falls back to home\\AppData\\Roaming', () => {
    const result = configDir('win32', {}, 'C:\\Users\\user')
    expect(result).toBe(join('C:\\Users\\user', 'AppData', 'Roaming', 'SeniorDev'))
  })
  it('linux → ~/.config/SeniorDev', () => {
    const result = configDir('linux', {}, '/home/user')
    expect(result).toBe(join('/home/user', '.config', 'SeniorDev'))
  })
  it('darwin → ~/.config/SeniorDev', () => {
    const result = configDir('darwin', {}, '/Users/user')
    expect(result).toBe(join('/Users/user', '.config', 'SeniorDev'))
  })
})
