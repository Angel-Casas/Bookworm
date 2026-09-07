import { describe, expect, it } from 'vitest'
import { describeFailure, ENGLISH_FAILURES, setupFailure } from '../failure'

describe('setupFailure', () => {
  it('says nothing when the assistant is ready', () => {
    expect(setupFailure(true, true)).toBeNull()
  })

  it('asks for a key before it asks for a model', () => {
    // One thing to fix at a time, in the order the settings page asks for it.
    expect(setupFailure(false, false)?.kind).toBe('no-key')
    expect(setupFailure(true, false)?.kind).toBe('no-model')
  })

  it('points at settings, because that is where the fix is', () => {
    expect(setupFailure(false, true)?.action).toBe('settings')
  })
})

describe('describeFailure', () => {
  it('knows a refused key from an empty wallet', () => {
    expect(describeFailure(401).kind).toBe('bad-key')
    expect(describeFailure(403).kind).toBe('bad-key')
    expect(describeFailure(402).kind).toBe('no-balance')
  })

  it('sends both of those to settings, and the rest to another go', () => {
    expect(describeFailure(401).action).toBe('settings')
    expect(describeFailure(402).action).toBe('settings')
    expect(describeFailure(500).action).toBe('retry')
    expect(describeFailure(429).action).toBe('retry')
  })

  it('reads no status at all as no connection', () => {
    // A request that never reached anybody has no HTTP code to report.
    expect(describeFailure(null).kind).toBe('offline')
    expect(describeFailure(undefined).kind).toBe('offline')
  })

  it('believes the browser when it says it is offline', () => {
    expect(describeFailure(500, false).kind).toBe('offline')
  })

  it('keeps the words a reader would search the web with', () => {
    expect(describeFailure(401).message).toContain('API key was rejected')
    expect(describeFailure(null).message).toContain('Check your internet connection')
    expect(describeFailure(402).message).toContain('balance appears to be empty')
  })

  it('names the number when there is one, and does not when there is not', () => {
    expect(describeFailure(503).message).toContain('503')
    expect(describeFailure(418).message).not.toContain('()')
    expect(describeFailure(418).message).toContain('418')
  })

  it('takes its sentences from outside, like the rest of the app’s text', () => {
    const spanish = {
      ...ENGLISH_FAILURES,
      'bad-key': { message: 'Tu clave fue rechazada.', actionLabel: 'Ajustes' },
    }
    const failure = describeFailure(401, true, spanish)
    expect(failure.message).toBe('Tu clave fue rechazada.')
    expect(failure.actionLabel).toBe('Ajustes')
    expect(failure.action).toBe('settings')
  })
})
