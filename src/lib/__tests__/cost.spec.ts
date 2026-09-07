import { describe, expect, it } from 'vitest'
import { computeCostUsd, formatUsd } from '../cost'

describe('computeCostUsd', () => {
  const pricing = { promptPrice: 0.5, completionPrice: 1.5 }

  it('computes prompt + completion cost per million tokens', () => {
    expect(computeCostUsd({ promptTokens: 1_000_000, completionTokens: 0 }, pricing)).toBe(0.5)
    expect(computeCostUsd({ promptTokens: 420, completionTokens: 6 }, pricing)).toBeCloseTo(
      0.000219,
      9,
    )
  })
  it('returns null without pricing or with nonsense usage', () => {
    expect(computeCostUsd({ promptTokens: 10, completionTokens: 10 }, null)).toBeNull()
    expect(computeCostUsd({ promptTokens: -1, completionTokens: 0 }, pricing)).toBeNull()
  })
})

describe('formatUsd', () => {
  it('uses more decimals for smaller amounts', () => {
    expect(formatUsd(12.3456)).toBe('$12.35')
    expect(formatUsd(0.1234)).toBe('$0.12')
    expect(formatUsd(0.0234)).toBe('$0.0234')
    expect(formatUsd(0.000219)).toBe('$0.000219')
  })
  it('handles edge cases', () => {
    expect(formatUsd(0)).toBe('$0.00')
    expect(formatUsd(null)).toBe('—')
    expect(formatUsd(Number.NaN)).toBe('—')
    expect(formatUsd(-5)).toBe('—')
  })
})
