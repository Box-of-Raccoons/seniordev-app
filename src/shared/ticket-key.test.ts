import { describe, expect, it } from 'vitest'
import { isTicketKey } from './ticket-key'

describe('isTicketKey', () => {
  it('accepts a standard key', () => expect(isTicketKey('PROJ-123')).toBe(true))
  it('accepts a lowercase key', () => expect(isTicketKey('sd-6')).toBe(true))
  it('accepts digits in the project part after the first letter', () => expect(isTicketKey('A1B2-9')).toBe(true))
  it('rejects a flag', () => expect(isTicketKey('--yolo')).toBe(false))
  it('rejects prose', () => expect(isTicketKey('notaticket')).toBe(false))
  it('rejects a digit-leading project', () => expect(isTicketKey('1AB-2')).toBe(false))
  it('rejects a missing number', () => expect(isTicketKey('PROJ-')).toBe(false))
})
