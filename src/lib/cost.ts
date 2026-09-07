/** Pure money math for LLM usage. Prices are USD per million tokens. */
import { formatMoney, type Locale } from '@/lib/format'

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
}

export interface ModelPricing {
  /** USD per million prompt tokens. */
  promptPrice: number
  /** USD per million completion tokens. */
  completionPrice: number
}

/** Cost of one request in USD, or null when pricing is unknown. */
export function computeCostUsd(usage: TokenUsage, pricing: ModelPricing | null): number | null {
  if (pricing === null) return null
  if (usage.promptTokens < 0 || usage.completionTokens < 0) return null
  return (
    (usage.promptTokens * pricing.promptPrice + usage.completionTokens * pricing.completionPrice) /
    1_000_000
  )
}

/**
 * Format a USD amount for display. Small LLM costs need sub-cent precision:
 * amounts under a cent keep enough decimals to stay meaningful. The SHAPE of
 * the number — grouping, decimal mark, which side the sign goes — belongs to
 * the reader's language, so it is asked for (see lib/format).
 */
export function formatUsd(amount: number | null, locale: Locale = 'en'): string {
  return formatMoney(amount, locale)
}
