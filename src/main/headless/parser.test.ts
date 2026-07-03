import { describe, expect, it } from 'vitest'
import { LineBuffer } from './parser'

describe('LineBuffer', () => {
  it('splits complete lines and buffers the partial tail', () => {
    const b = new LineBuffer()
    expect(b.push('one\ntwo\npar')).toEqual(['one', 'two'])
    expect(b.push('tial\n')).toEqual(['partial'])
  })
  it('handles CRLF', () => {
    const b = new LineBuffer()
    expect(b.push('a\r\nb\r\n')).toEqual(['a', 'b'])
  })
  it('flush returns the remaining tail once', () => {
    const b = new LineBuffer()
    b.push('tail-no-newline')
    expect(b.flush()).toEqual(['tail-no-newline'])
    expect(b.flush()).toEqual([])
  })
})
