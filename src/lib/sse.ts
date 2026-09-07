/** Pure Server-Sent-Events parsing helpers for OpenAI-style streaming. */

export interface SseExtraction {
  /** Complete `data:` payloads found in the buffer. */
  events: string[]
  /** Unconsumed tail (incomplete event) to prepend to the next chunk. */
  rest: string
}

/** Split a stream buffer into complete SSE data payloads and the leftover tail. */
export function extractSseEvents(buffer: string): SseExtraction {
  const events: string[] = []
  const normalized = buffer.replace(/\r\n/g, '\n')
  const segments = normalized.split('\n\n')
  const rest = segments.pop() ?? ''
  for (const segment of segments) {
    const dataLines = segment
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
    if (dataLines.length > 0) events.push(dataLines.join('\n'))
  }
  return { events, rest }
}

export interface ChatChunk {
  delta: string | null
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null
  done: boolean
}

/** Interpret one SSE data payload from a chat-completions stream. */
export function parseChatChunk(data: string): ChatChunk {
  if (data === '[DONE]') return { delta: null, usage: null, done: true }
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return { delta: null, usage: null, done: false }
  }
  const record = parsed as {
    choices?: Array<{ delta?: { content?: unknown } }>
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown }
  }
  const content = record.choices?.[0]?.delta?.content
  const usageRaw = record.usage
  const usage =
    usageRaw && typeof usageRaw.total_tokens === 'number'
      ? {
          promptTokens: typeof usageRaw.prompt_tokens === 'number' ? usageRaw.prompt_tokens : 0,
          completionTokens:
            typeof usageRaw.completion_tokens === 'number' ? usageRaw.completion_tokens : 0,
          totalTokens: usageRaw.total_tokens,
        }
      : null
  return { delta: typeof content === 'string' ? content : null, usage, done: false }
}
