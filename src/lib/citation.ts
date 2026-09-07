/**
 * Citations: turning "[Chapter 4]" in an answer back into a place in the book.
 *
 * The references sent with a question already carry labels ("Chapter 4",
 * "Page 112") and the position they came from. If the model cites those labels
 * verbatim, an answer stops being a wall of prose and becomes a set of doors
 * back into the text — and the reader can check it rather than trust it.
 *
 * Matching is deliberately strict: a citation only becomes pressable when its
 * label is one we actually sent. A model that invents "[Chapter 9]" gets plain
 * text, which is the honest outcome — we cannot send someone to a page we
 * never looked at.
 */

export interface CitationSource {
  label: string
  /** Where the reference came from: a CFI, or a PDF page number as string. */
  position: string
}

export interface CitationPart {
  kind: 'text' | 'citation'
  text: string
  /** Present on a citation: where pressing it should take the reader. */
  position?: string
}

/** The instruction appended to the system prompt when references are sent. */
export function citationInstruction(labels: readonly string[]): string {
  if (labels.length === 0) return ''
  const list = labels.map((label) => `[${label}]`).join(', ')
  return [
    'When a statement comes from a reference block, cite it inline in square',
    `brackets using the block's exact label — available labels: ${list}.`,
    'Cite only these labels, never invent one, and put the citation right after',
    'the sentence it supports rather than collecting them at the end.',
  ].join(' ')
}

/** Escape a label for use inside a regular expression. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Split an answer into text and citations. Only labels present in `sources`
 * become citations; unknown brackets stay as literal text.
 *
 * A bracket may hold several labels ("[Chapter 3, Chapter 4]"); each becomes
 * its own citation so each is separately pressable.
 */
export function parseCitations(
  answer: string,
  sources: readonly CitationSource[],
): CitationPart[] {
  if (sources.length === 0 || answer.length === 0) {
    return answer.length > 0 ? [{ kind: 'text', text: answer }] : []
  }
  const byLabel = new Map(sources.map((source) => [source.label.toLowerCase(), source]))
  // Longest labels first, so "Chapter 12" is never matched as "Chapter 1".
  const alternatives = [...byLabel.values()]
    .map((source) => source.label)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|')
  const pattern = new RegExp(`\\[\\s*((?:${alternatives})(?:\\s*[,;]\\s*(?:${alternatives}))*)\\s*\\]`, 'gi')

  const parts: CitationPart[] = []
  let cursor = 0
  for (const match of answer.matchAll(pattern)) {
    const start = match.index ?? 0
    if (start > cursor) parts.push({ kind: 'text', text: answer.slice(cursor, start) })
    for (const raw of (match[1] ?? '').split(/[,;]/)) {
      const source = byLabel.get(raw.trim().toLowerCase())
      if (source) parts.push({ kind: 'citation', text: source.label, position: source.position })
    }
    cursor = start + match[0].length
  }
  if (cursor < answer.length) parts.push({ kind: 'text', text: answer.slice(cursor) })
  return parts
}
