/** Pure token-budget helpers. Estimates are heuristic (≈4 chars per token). */

export const CHARS_PER_TOKEN = 4

/** Rough token estimate for a text. Deterministic; errs slightly high. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

export interface TextBlock {
  label: string
  text: string
}

export interface FitResult {
  blocks: TextBlock[]
  truncated: boolean
  estimatedTokens: number
}

/**
 * Fit blocks into a token budget, preserving order and priority (earlier blocks
 * win). A block that partially fits is truncated with an ellipsis marker; later
 * blocks are dropped entirely.
 */
export function fitBlocksToBudget(blocks: TextBlock[], maxTokens: number): FitResult {
  const maxChars = Math.max(0, maxTokens) * CHARS_PER_TOKEN
  const kept: TextBlock[] = []
  let used = 0
  let truncated = false

  for (const block of blocks) {
    const remaining = maxChars - used
    if (remaining <= 0) {
      truncated = true
      break
    }
    if (block.text.length <= remaining) {
      kept.push(block)
      used += block.text.length
    } else {
      const marker = '\n[… truncated to fit the model context …]'
      const sliceLength = Math.max(0, remaining - marker.length)
      if (sliceLength > 0) {
        kept.push({ label: block.label, text: block.text.slice(0, sliceLength) + marker })
        used += remaining
      }
      truncated = true
      break
    }
  }

  return { blocks: kept, truncated, estimatedTokens: Math.ceil(used / CHARS_PER_TOKEN) }
}
