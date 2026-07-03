import { describe, it, expect, vi } from 'vitest'
import { runWithWarning } from './watchdog'

describe('runWithWarning', () => {
  it('fires onWarn once when the promise runs past warnMs', async () => {
    vi.useFakeTimers()
    try {
      const onWarn = vi.fn()
      let resolve!: (v: string) => void
      const p = new Promise<string>((r) => { resolve = r })
      const wrapped = runWithWarning(p, 1000, onWarn)
      await vi.advanceTimersByTimeAsync(999)
      expect(onWarn).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(onWarn).toHaveBeenCalledTimes(1)
      resolve('done')
      expect(await wrapped).toBe('done')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not fire when the promise settles first', async () => {
    vi.useFakeTimers()
    try {
      const onWarn = vi.fn()
      const wrapped = runWithWarning(Promise.resolve('x'), 1000, onWarn)
      expect(await wrapped).toBe('x')
      await vi.advanceTimersByTimeAsync(5000)
      expect(onWarn).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('is disabled when warnMs <= 0 (no timer, passes the value through)', async () => {
    const onWarn = vi.fn()
    expect(await runWithWarning(Promise.resolve(42), 0, onWarn)).toBe(42)
    expect(onWarn).not.toHaveBeenCalled()
  })

  it('propagates rejection and still clears the timer', async () => {
    vi.useFakeTimers()
    try {
      const onWarn = vi.fn()
      await expect(runWithWarning(Promise.reject(new Error('boom')), 1000, onWarn)).rejects.toThrow('boom')
      await vi.advanceTimersByTimeAsync(5000)
      expect(onWarn).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
