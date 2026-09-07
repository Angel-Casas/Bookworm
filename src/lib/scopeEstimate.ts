/**
 * What a question is about to cost, before it is sent.
 *
 * Bookworm bills per token against the reader's own NanoGPT balance, and the
 * scope control can quietly multiply a message by a thousand: "Whole book" on
 * a long novel is a different order of expense from "Current chapter". The
 * running total in the header is an autopsy; this is the estimate that makes
 * the scope a decision instead of a guess.
 *
 * The same numbers also say, in advance, whether the chosen scope will even
 * fit — which the reader currently only learns after paying for the truncated
 * send.
 */
import { computeCostUsd, formatUsd, type ModelPricing } from '@/lib/cost'
import { estimateTokens } from '@/lib/tokens'

export interface ScopeEstimate {
  /** Prompt tokens the references and question are expected to occupy. */
  tokens: number
  /** True when the scope exceeds the budget and will be cut to fit. */
  overBudget: boolean
  /** Estimated USD for this one send, or null when pricing is unknown. */
  costUsd: number | null
}

export interface EstimateInput {
  /** Text of every reference block that would be attached. */
  referenceTexts: readonly string[]
  /** The reader's question, plus anything already in the conversation. */
  conversationChars: number
  /** Prompt tokens available to the references (context minus reserve). */
  budgetTokens: number
  /** Tokens the reply is assumed to take, for the cost half of the estimate. */
  reservedCompletionTokens: number
  pricing: ModelPricing | null
}

export function estimateScope(input: EstimateInput): ScopeEstimate {
  const referenceTokens = input.referenceTexts.reduce(
    (total, text) => total + estimateTokens(text),
    0,
  )
  const conversationTokens = estimateTokens('x'.repeat(Math.max(0, input.conversationChars)))
  // Over budget is judged on the references alone: they are what gets cut.
  const overBudget = referenceTokens > input.budgetTokens
  const promptTokens = Math.min(referenceTokens, input.budgetTokens) + conversationTokens
  return {
    tokens: promptTokens,
    overBudget,
    costUsd: computeCostUsd(
      { promptTokens, completionTokens: input.reservedCompletionTokens },
      input.pricing,
    ),
  }
}

/** Compact token count: 940, 12k, 1.4M — a size, read at a glance. */
export function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 0) return '—'
  if (tokens < 1000) return String(Math.round(tokens))
  if (tokens < 1_000_000) {
    const thousands = tokens / 1000
    return `${thousands < 10 ? thousands.toFixed(1) : Math.round(thousands)}k`
  }
  return `${(tokens / 1_000_000).toFixed(1)}M`
}

/**
 * The one line shown beside the scope control. The word for "tokens" is handed
 * in — the number and the money shape themselves from the locale.
 */
export function formatEstimate(
  estimate: ScopeEstimate,
  locale = 'en',
  tokensWord = 'tokens',
): string {
  const size = `~${formatTokens(estimate.tokens)} ${tokensWord}`
  if (estimate.costUsd === null) return size
  return `${size} · ${formatUsd(estimate.costUsd, locale)}`
}
