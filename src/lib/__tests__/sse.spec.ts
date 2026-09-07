import { describe, expect, it } from 'vitest'
import { extractSseEvents, parseChatChunk } from '../sse'

describe('extractSseEvents', () => {
  it('extracts complete events and keeps the incomplete tail', () => {
    const { events, rest } = extractSseEvents('data: one\n\ndata: two\n\ndata: par')
    expect(events).toEqual(['one', 'two'])
    expect(rest).toBe('data: par')
  })
  it('handles CRLF and multi-line data', () => {
    const { events } = extractSseEvents('data: a\r\ndata: b\r\n\r\n')
    expect(events).toEqual(['a\nb'])
  })
  it('ignores non-data lines (comments, event names)', () => {
    const { events } = extractSseEvents(': keepalive\n\nevent: ping\ndata: x\n\n')
    expect(events).toEqual(['x'])
  })
})

describe('parseChatChunk', () => {
  it('detects the DONE sentinel', () => {
    expect(parseChatChunk('[DONE]').done).toBe(true)
  })
  it('extracts content deltas', () => {
    const chunk = parseChatChunk('{"choices":[{"delta":{"content":"Hi"}}]}')
    expect(chunk.delta).toBe('Hi')
    expect(chunk.done).toBe(false)
  })
  it('extracts usage from the final chunk', () => {
    const chunk = parseChatChunk(
      '{"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}',
    )
    expect(chunk.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 })
  })
  it('survives malformed JSON', () => {
    expect(parseChatChunk('not json').delta).toBeNull()
  })
})
