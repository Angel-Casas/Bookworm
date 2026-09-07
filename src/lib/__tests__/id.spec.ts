import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateId } from '../id'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('generateId', () => {
  it('produces RFC 4122 v4 UUIDs', () => {
    expect(generateId()).toMatch(UUID_V4)
  })

  it('produces unique values', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateId()))
    expect(ids.size).toBe(1000)
  })

  it('works without randomUUID (insecure context, e.g. phone over LAN HTTP)', () => {
    const realCrypto = globalThis.crypto
    vi.stubGlobal('crypto', {
      getRandomValues: realCrypto.getRandomValues.bind(realCrypto),
    })
    const id = generateId()
    expect(id).toMatch(UUID_V4)
    expect(new Set([id, generateId(), generateId()]).size).toBe(3)
  })

  it('works with no crypto object at all', () => {
    vi.stubGlobal('crypto', undefined)
    expect(generateId()).toMatch(UUID_V4)
  })
})
