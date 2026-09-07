/**
 * NanoGPT HTTP client (OpenAI-compatible API). All network side effects for
 * the LLM live here; parsing logic is pure and lives in src/lib/sse.ts.
 */
import { NANOGPT_ACCOUNT_API_BASE, NANOGPT_API_BASE } from '@/config'
import { hasVariablePrice, isSelectableModel } from '@/lib/modelIndex'
import { extractSseEvents, parseChatChunk } from '@/lib/sse'
import type { ChatMessage } from '@/lib/prompt'

export class NanoGptError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message)
    this.name = 'NanoGptError'
  }
}

export interface NanoModel {
  id: string
  name: string
  contextLength: number | null
  /** USD per million tokens. */
  promptPrice: number | null
  completionPrice: number | null
}

interface RawModel {
  id?: unknown
  name?: unknown
  context_length?: unknown
  pricing?: { prompt?: unknown; completion?: unknown }
}

const OFFLINE_MESSAGE = 'Could not reach NanoGPT. Check your internet connection and try again.'

async function safeFetch(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch {
    throw new NanoGptError(OFFLINE_MESSAGE, null)
  }
}

export async function listModels(): Promise<NanoModel[]> {
  const response = await safeFetch(`${NANOGPT_API_BASE}/models?detailed=true`)
  if (!response.ok) {
    throw new NanoGptError(`Could not load model list (HTTP ${response.status}).`, response.status)
  }
  const payload = (await response.json()) as { data?: RawModel[] }
  const models: NanoModel[] = []
  for (const raw of payload.data ?? []) {
    if (typeof raw.id !== 'string') continue
    // Support assistants and the like are not books' models — drop them here,
    // so nothing downstream can offer, pin or restore one.
    if (!isSelectableModel({ id: raw.id })) continue
    // The auto model reports zeroes because its price depends on what it
    // picks; carrying those through would price a message at nothing.
    const varies = hasVariablePrice(raw.id)
    models.push({
      id: raw.id,
      name: typeof raw.name === 'string' ? raw.name : raw.id,
      contextLength: typeof raw.context_length === 'number' ? raw.context_length : null,
      promptPrice: !varies && typeof raw.pricing?.prompt === 'number' ? raw.pricing.prompt : null,
      completionPrice:
        !varies && typeof raw.pricing?.completion === 'number' ? raw.pricing.completion : null,
    })
  }
  return models
}

export interface ChatUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface StreamChatOptions {
  apiKey: string
  model: string
  messages: ChatMessage[]
  onDelta: (text: string) => void
  signal?: AbortSignal
}

/** Stream a chat completion; resolves with usage when the stream ends. */
export async function streamChat(options: StreamChatOptions): Promise<{ usage: ChatUsage | null }> {
  const response = await safeFetch(`${NANOGPT_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      stream: true,
      stream_options: { include_usage: true },
    }),
    signal: options.signal ?? null,
  })

  if (!response.ok || response.body === null) {
    const detail = await response.text().catch(() => '')
    const friendly =
      response.status === 401 || response.status === 403
        ? 'Your NanoGPT API key was rejected. Check it in Settings.'
        : response.status === 402
          ? 'Your NanoGPT balance appears to be empty.'
          : `The model request failed (HTTP ${response.status}). ${detail.slice(0, 200)}`
    throw new NanoGptError(friendly, response.status)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let usage: ChatUsage | null = null

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const { events, rest } = extractSseEvents(buffer)
    buffer = rest
    for (const event of events) {
      const chunk = parseChatChunk(event)
      if (chunk.delta) options.onDelta(chunk.delta)
      if (chunk.usage) usage = chunk.usage
      if (chunk.done) return { usage }
    }
  }
  return { usage }
}

export interface Balance {
  usdBalance: number
}

/** Fetch the account balance (separate legacy endpoint using x-api-key auth). */
export async function checkBalance(apiKey: string): Promise<Balance> {
  const response = await safeFetch(`${NANOGPT_ACCOUNT_API_BASE}/check-balance`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey },
  })
  if (!response.ok) {
    throw new NanoGptError(`Balance check failed (HTTP ${response.status}).`, response.status)
  }
  const payload = (await response.json()) as { usd_balance?: unknown }
  const parsed = Number.parseFloat(String(payload.usd_balance))
  if (!Number.isFinite(parsed)) {
    throw new NanoGptError('Balance response was not understood.', null)
  }
  return { usdBalance: parsed }
}
