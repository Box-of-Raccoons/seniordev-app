import { describe, it, expect } from 'vitest'
import { nextStatus, IDLE, type UpdateStatus } from './update-status'

describe('nextStatus', () => {
  it('reports a check in progress', () => {
    expect(nextStatus(IDLE, { type: 'checking' })).toEqual({ state: 'checking' })
  })

  it('goes straight to downloading when an update is found (autoDownload is on)', () => {
    expect(nextStatus({ state: 'checking' }, { type: 'available', version: '0.6.0' })).toEqual({
      state: 'downloading',
      version: '0.6.0',
      percent: 0
    })
  })

  it('keeps the version while progress ticks, and rounds the percent', () => {
    const prev: UpdateStatus = { state: 'downloading', version: '0.6.0', percent: 0 }
    expect(nextStatus(prev, { type: 'progress', percent: 41.6 })).toEqual({
      state: 'downloading',
      version: '0.6.0',
      percent: 42
    })
  })

  it('clamps a percent outside 0-100 instead of showing it raw', () => {
    const prev: UpdateStatus = { state: 'downloading', version: '0.6.0', percent: 0 }
    expect(nextStatus(prev, { type: 'progress', percent: 103.7 }).percent).toBe(100)
    expect(nextStatus(prev, { type: 'progress', percent: -5 }).percent).toBe(0)
    expect(nextStatus(prev, { type: 'progress', percent: Number.NaN }).percent).toBe(0)
  })

  it('returns to idle when the check finds nothing', () => {
    expect(nextStatus({ state: 'checking' }, { type: 'none' })).toEqual(IDLE)
  })

  it('reports an error with its message', () => {
    expect(nextStatus({ state: 'checking' }, { type: 'error', message: 'ENOTFOUND' })).toEqual({
      state: 'error',
      message: 'ENOTFOUND'
    })
  })

  it('becomes ready once the download completes', () => {
    const prev: UpdateStatus = { state: 'downloading', version: '0.6.0', percent: 99 }
    expect(nextStatus(prev, { type: 'downloaded', version: '0.6.0' })).toEqual({
      state: 'ready',
      version: '0.6.0'
    })
  })

  // The reason this reducer exists rather than assigning state per event: the
  // six-hourly poll keeps running after an update is staged, and any of these
  // would otherwise wipe out the "installs when you quit" affordance.
  it('keeps a staged update through a later check, a no-update result, and an error', () => {
    const ready: UpdateStatus = { state: 'ready', version: '0.6.0' }
    expect(nextStatus(ready, { type: 'checking' })).toEqual(ready)
    expect(nextStatus(ready, { type: 'none' })).toEqual(ready)
    expect(nextStatus(ready, { type: 'error', message: 'offline' })).toEqual(ready)
    expect(nextStatus(ready, { type: 'progress', percent: 10 })).toEqual(ready)
  })

  it('replaces a staged update when a newer one finishes downloading', () => {
    const ready: UpdateStatus = { state: 'ready', version: '0.6.0' }
    expect(nextStatus(ready, { type: 'downloaded', version: '0.6.1' })).toEqual({
      state: 'ready',
      version: '0.6.1'
    })
  })
})
