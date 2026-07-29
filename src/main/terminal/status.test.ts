import { describe, it, expect } from 'vitest'
import { nextStatus, resolveExit, INITIAL_STATUS, type Status, type TabKind } from './status'

describe('resolveExit — the spec 5.2 two-by-two, both event sources', () => {
  // headless = the YOLO (yolo:exit) source; interactive/shell = the pty (pty:exit) source.
  it('headless exit 0 → needsReview', () => {
    expect(resolveExit('headless', 0)).toBe('needsReview')
  })
  it('headless non-zero exit → failed', () => {
    expect(resolveExit('headless', 1)).toBe('failed')
    expect(resolveExit('headless', 137)).toBe('failed')
  })
  it('interactive exit 0 → autoClose (the S3 cell, kept honest)', () => {
    expect(resolveExit('interactive', 0)).toBe('autoClose')
  })
  it('interactive non-zero exit → failed', () => {
    expect(resolveExit('interactive', 1)).toBe('failed')
  })
  it('shell behaves like interactive on exit (both ride the pty)', () => {
    expect(resolveExit('shell', 0)).toBe('autoClose')
    expect(resolveExit('shell', 2)).toBe('failed')
  })
})

describe('nextStatus — spawn and data', () => {
  it('spawn → working', () => {
    expect(nextStatus(undefined, { type: 'spawn' }, 'interactive')).toBe('working')
    expect(nextStatus('idle', { type: 'spawn' }, 'interactive')).toBe('working')
  })

  it('INITIAL_STATUS is working', () => {
    expect(INITIAL_STATUS).toBe('working')
  })

  it('data → working from any live state and any source', () => {
    for (const from of ['working', 'idle', 'needsYou'] as Status[]) {
      expect(nextStatus(from, { type: 'data' }, 'interactive')).toBe('working')
      expect(nextStatus(from, { type: 'data' }, 'headless')).toBe('working')
    }
    expect(nextStatus(undefined, { type: 'data' }, 'interactive')).toBe('working')
  })

  it('data on a terminal state is absorbed (no flip back to working)', () => {
    expect(nextStatus('failed', { type: 'data' }, 'interactive')).toBe('failed')
    expect(nextStatus('needsReview', { type: 'data' }, 'headless')).toBe('needsReview')
  })
})

describe('nextStatus — quiet and the buffer scan', () => {
  it('quiet with no prompt match → idle', () => {
    expect(nextStatus('working', { type: 'quiet', promptMatched: false }, 'interactive')).toBe('idle')
  })

  it('quiet with a prompt match → needsYou', () => {
    expect(nextStatus('working', { type: 'quiet', promptMatched: true }, 'interactive')).toBe('needsYou')
  })

  it('a re-scan can flip idle → needsYou and needsYou → idle', () => {
    expect(nextStatus('idle', { type: 'quiet', promptMatched: true }, 'interactive')).toBe('needsYou')
    expect(nextStatus('needsYou', { type: 'quiet', promptMatched: false }, 'interactive')).toBe('idle')
  })

  it('shell tabs are scannable and get idle / needsYou like interactive', () => {
    expect(nextStatus('working', { type: 'quiet', promptMatched: true }, 'shell')).toBe('needsYou')
    expect(nextStatus('working', { type: 'quiet', promptMatched: false }, 'shell')).toBe('idle')
  })

  it('headless tabs are never scanned — a quiet event does not change them', () => {
    expect(nextStatus('working', { type: 'quiet', promptMatched: true }, 'headless')).toBe('working')
    expect(nextStatus(undefined, { type: 'quiet', promptMatched: false }, 'headless')).toBe('working')
  })

  it('quiet on a terminal state is absorbed', () => {
    expect(nextStatus('failed', { type: 'quiet', promptMatched: true }, 'interactive')).toBe('failed')
  })
})

describe('nextStatus — exit, every 2x2 cell rendered for S1', () => {
  it('headless exit 0 → needsReview, non-zero → failed', () => {
    expect(nextStatus('working', { type: 'exit', code: 0 }, 'headless')).toBe('needsReview')
    expect(nextStatus('working', { type: 'exit', code: 1 }, 'headless')).toBe('failed')
  })

  it('interactive exit 0 → failed (S1 interim static dot; S3 will auto-close)', () => {
    expect(nextStatus('idle', { type: 'exit', code: 0 }, 'interactive')).toBe('failed')
  })

  it('interactive non-zero exit → failed', () => {
    expect(nextStatus('working', { type: 'exit', code: 1 }, 'interactive')).toBe('failed')
  })

  it('shell exit 0 → failed (interim), non-zero → failed', () => {
    expect(nextStatus('idle', { type: 'exit', code: 0 }, 'shell')).toBe('failed')
    expect(nextStatus('working', { type: 'exit', code: 130 }, 'shell')).toBe('failed')
  })
})
