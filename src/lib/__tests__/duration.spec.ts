import { describe, expect, it } from 'vitest'
import { formatDuration } from '../duration'

describe('formatDuration', () => {
  it('formats across ranges', () => {
    expect(formatDuration(30)).toBe('<1m')
    expect(formatDuration(90)).toBe('1m')
    expect(formatDuration(45 * 60)).toBe('45m')
    expect(formatDuration(3 * 3600 + 12 * 60)).toBe('3h 12m')
    expect(formatDuration(2 * 3600)).toBe('2h')
  })
  it('rejects nonsense', () => {
    expect(formatDuration(-5)).toBe('—')
    expect(formatDuration(Number.NaN)).toBe('—')
  })
})
