import { describe, expect, it } from 'vitest'
import { estimateTokens, fitBlocksToBudget } from '../tokens'

describe('estimateTokens', () => {
  it('estimates ~4 chars per token, rounding up', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcde')).toBe(2)
  })
})

describe('fitBlocksToBudget', () => {
  const block = (label: string, size: number) => ({ label, text: 'x'.repeat(size) })

  it('keeps everything under budget', () => {
    const result = fitBlocksToBudget([block('a', 40), block('b', 40)], 100)
    expect(result.blocks).toHaveLength(2)
    expect(result.truncated).toBe(false)
  })
  it('truncates the overflowing block and drops the rest', () => {
    const result = fitBlocksToBudget([block('a', 400), block('b', 400)], 50)
    expect(result.blocks).toHaveLength(1)
    expect(result.blocks[0]!.text).toContain('truncated')
    expect(result.blocks[0]!.text.length).toBeLessThanOrEqual(200)
    expect(result.truncated).toBe(true)
  })
  it('handles zero budget', () => {
    const result = fitBlocksToBudget([block('a', 10)], 0)
    expect(result.blocks).toHaveLength(0)
    expect(result.truncated).toBe(true)
  })
})
