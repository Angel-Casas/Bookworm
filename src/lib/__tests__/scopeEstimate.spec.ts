import { describe, expect, it } from 'vitest'
import { estimateScope, formatEstimate, formatTokens } from '../scopeEstimate'

const pricing = { promptPrice: 3, completionPrice: 15 } // USD per million

const base = {
  conversationChars: 0,
  budgetTokens: 100_000,
  reservedCompletionTokens: 1000,
  pricing,
}

describe('estimateScope', () => {
  it('counts the references it would attach', () => {
    // 4 chars ≈ 1 token.
    const estimate = estimateScope({ ...base, referenceTexts: ['x'.repeat(4000)] })
    expect(estimate.tokens).toBe(1000)
    expect(estimate.overBudget).toBe(false)
  })

  it('adds what the conversation already costs to resend', () => {
    const estimate = estimateScope({ ...base, referenceTexts: ['x'.repeat(400)], conversationChars: 800 })
    expect(estimate.tokens).toBe(100 + 200)
  })

  it('flags a scope that will be cut, and stops counting past the budget', () => {
    const estimate = estimateScope({
      ...base,
      budgetTokens: 500,
      referenceTexts: ['x'.repeat(40_000)],
    })
    expect(estimate.overBudget).toBe(true)
    // What you pay for is what fits, not what you asked for.
    expect(estimate.tokens).toBe(500)
  })

  it('prices the send, reply included', () => {
    const estimate = estimateScope({ ...base, referenceTexts: ['x'.repeat(4000)] })
    // 1000 prompt @ $3/M + 1000 completion @ $15/M
    expect(estimate.costUsd).toBeCloseTo(0.003 + 0.015, 6)
  })

  it('reports no price when the model has none', () => {
    const estimate = estimateScope({ ...base, pricing: null, referenceTexts: ['abcd'] })
    expect(estimate.costUsd).toBeNull()
    expect(estimate.tokens).toBe(1)
  })

  it('handles a scope of nothing', () => {
    const estimate = estimateScope({ ...base, referenceTexts: [] })
    expect(estimate.tokens).toBe(0)
    expect(estimate.overBudget).toBe(false)
  })
})

describe('formatTokens', () => {
  it('reads as a size at a glance', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(940)).toBe('940')
    expect(formatTokens(1400)).toBe('1.4k')
    expect(formatTokens(38_000)).toBe('38k')
    expect(formatTokens(1_400_000)).toBe('1.4M')
  })

  it('refuses nonsense rather than printing it', () => {
    expect(formatTokens(Number.NaN)).toBe('—')
    expect(formatTokens(-5)).toBe('—')
  })
})

describe('formatEstimate', () => {
  it('gives a size and a price', () => {
    expect(formatEstimate({ tokens: 38_000, overBudget: false, costUsd: 0.012 })).toBe(
      '~38k tokens · $0.0120',
    )
  })

  it('gives the size alone when the price is unknown', () => {
    expect(formatEstimate({ tokens: 900, overBudget: false, costUsd: null })).toBe('~900 tokens')
  })
})
