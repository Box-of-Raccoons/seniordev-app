import { describe, it, expect } from 'vitest'
import { deliveryOptionsFor } from './delivery-options'
import type { Config } from '../config/schema'

const cfg = {
  defaultTool: 'claude',
  cliTools: {
    claude: { command: 'claude', interactiveArgs: [], promptDelivery: 'stdin' },
    codex: { command: 'codex', interactiveArgs: [], promptDelivery: 'stdin', bracketedPaste: true }
  }
} as unknown as Config

describe('deliveryOptionsFor', () => {
  it('refuses to guess when no config is loaded', () => {
    // Defaulting here would send a multi-line prompt into codex unframed.
    expect(() => deliveryOptionsFor('codex', null)).toThrow(/no configuration is loaded/)
  })

  it('frames a paste for a tool that opts in', () => {
    expect(deliveryOptionsFor('codex', cfg)).toEqual({ tool: 'codex', bracketedPaste: true })
  })

  it('leaves it off for a tool that does not', () => {
    expect(deliveryOptionsFor('claude', cfg)).toEqual({ tool: 'claude', bracketedPaste: false })
  })

  it('falls back to the default tool for an unknown one', () => {
    // A conversation record can outlive the config entry that named its tool.
    expect(deliveryOptionsFor('retired-cli', cfg)).toEqual({ tool: 'claude', bracketedPaste: false })
  })

  it('uses the default tool when the caller names none', () => {
    expect(deliveryOptionsFor(undefined, { ...cfg, defaultTool: 'codex' })).toEqual({
      tool: 'codex',
      bracketedPaste: true
    })
  })
})
