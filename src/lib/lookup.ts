/**
 * Looking a word up without leaving the sentence it is in.
 *
 * A reader who meets an unfamiliar word mid-page has, until now, had two bad
 * options: leave the book for a dictionary tab, or open the assistant and type
 * out a question about a word that is already on screen. Neither is worth the
 * interruption, so most readers do neither and read on past the word.
 *
 * The fix is a very small question asked on their behalf. The word alone is not
 * enough — "charge" in a cavalry novel and "charge" in a legal one are
 * different words — so the SENTENCE around it goes along, and the answer is
 * about this use of it, here.
 *
 * Everything in this file is pure: what counts as a word worth looking up, how
 * to find the sentence it sits in, and what to ask. The spending and the
 * streaming live in the store.
 */
import type { BookInfo, ChatMessage } from '@/lib/prompt'

/** Longer than this and the reader is asking about a passage, not a word. */
export const LOOKUP_MAX_WORDS = 4
export const LOOKUP_MAX_CHARS = 48

/** Trailing and leading marks a selection drags in: quotes, commas, brackets. */
const EDGE_PUNCTUATION = /^[\s"'“”‘’«»([{¿¡.,;:!?…—–-]+|[\s"'“”‘’«»)\]}.,;:!?…—–-]+$/gu

/**
 * The word (or very short phrase) a selection amounts to, or null when the
 * selection is not the kind of thing a gloss can answer.
 *
 * Selections arrive with whatever the reader's finger caught — a trailing
 * comma, a line break in the middle, the quotation marks around a name — so
 * this tidies before it judges.
 */
export function lookupTerm(selection: string): string | null {
  const collapsed = selection.replace(/\s+/gu, ' ').trim().replace(EDGE_PUNCTUATION, '')
  if (collapsed.length === 0 || collapsed.length > LOOKUP_MAX_CHARS) return null
  // Something has to be a letter: a page number or a row of dashes is not a
  // word, and asking about one costs the same as asking about a real one.
  if (!/\p{L}/u.test(collapsed)) return null
  if (collapsed.split(' ').length > LOOKUP_MAX_WORDS) return null
  return collapsed
}

const SENTENCE_END = /[.!?…。！？]/u
/** Abbreviations whose full stop does not end a sentence. */
const ABBREVIATIONS = new Set([
  'mr',
  'mrs',
  'ms',
  'dr',
  'prof',
  'st',
  'sr',
  'jr',
  'vs',
  'etc',
  'no',
  'fig',
  'cf',
])

/** Does the mark at `index` actually close a sentence? */
function endsSentence(text: string, index: number): boolean {
  if (!SENTENCE_END.test(text[index] ?? '')) return false
  const next = text[index + 1]
  // A mark at the very end closes it; otherwise something must follow the gap.
  if (next === undefined) return true
  if (!/\s|["'”’»)\]]/u.test(next)) return false
  if (text[index] !== '.') return true
  const before = text.slice(0, index)
  const word = /(\p{L}+)$/u.exec(before)?.[1] ?? ''
  // "Mr. Bennet" and "H. G. Wells" are one sentence, not three.
  if (word.length === 1) return false
  return !ABBREVIATIONS.has(word.toLowerCase())
}

/**
 * The sentence containing `term` within `context` — the block of text the
 * selection was made in.
 *
 * When the term cannot be found (a selection spanning two elements, a PDF text
 * layer that broke the word across spans) this still returns something usable:
 * the start of the context, clamped. A slightly wrong sentence is far better
 * context than none, and the model is told it is the surrounding text, not a
 * quotation to be trusted word for word.
 */
export function sentenceAround(context: string, term: string, maxChars = 320): string {
  const text = context.replace(/\s+/gu, ' ').trim()
  if (text.length === 0) return ''
  const at = text.toLowerCase().indexOf(term.toLowerCase())
  if (at === -1) return text.slice(0, maxChars).trim()

  let start = 0
  for (let i = at - 1; i >= 0; i--) {
    if (endsSentence(text, i)) {
      start = i + 1
      break
    }
  }
  let end = text.length
  for (let i = at + term.length - 1; i < text.length; i++) {
    if (endsSentence(text, i)) {
      end = i + 1
      break
    }
  }

  const sentence = text.slice(start, end).trim()
  if (sentence.length <= maxChars) return sentence
  // A sentence longer than the budget is trimmed AROUND the word rather than
  // from the front, so the word never falls off the end of its own context.
  const local = sentence.toLowerCase().indexOf(term.toLowerCase())
  const half = Math.floor((maxChars - term.length) / 2)
  const from = Math.max(0, local - half)
  const clip = sentence.slice(from, from + maxChars).trim()
  return `${from > 0 ? '…' : ''}${clip}${from + maxChars < sentence.length ? '…' : ''}`
}

/**
 * The whole request for one gloss.
 *
 * Deliberately not the chat's system prompt: that one invites discussion, and
 * this is a margin note. It carries no conversation history, so it costs
 * roughly what its own words cost, and it says its length limit twice because
 * a model given a book and a word will otherwise write an essay about it.
 */
export function buildLookupMessages(
  book: BookInfo,
  term: string,
  sentence: string,
  spoilersAllowed: boolean,
  answerIn: string | null = null,
): ChatMessage[] {
  const authorPart = book.author ? ` by ${book.author}` : ''
  const system = [
    `You are a margin note in the book "${book.title}"${authorPart}. The reader has tapped a word while reading and wants to know what it means HERE.`,
    'Answer in at most two short sentences. No preamble, no restating the word, no markdown headings or lists — just the gloss, as a note in a margin.',
    'Give the sense the word carries in this sentence, not a list of every meaning it has. If it is a name, say who or what it is in this book; if it is a foreign or archaic word, translate it; if it is a term of art, say plainly what it refers to.',
    spoilersAllowed
      ? 'The reader has opted in to spoilers: you may draw on anything in the book.'
      : 'Do not reveal anything that happens later in the book — the reader has read only this far.',
    'If you do not know the word or the reference, say so in one line rather than guessing.',
    ...(answerIn
      ? [`Write the note in ${answerIn}, whatever language the book is written in.`]
      : []),
  ].join('\n')

  const user =
    sentence.length > 0
      ? `Word: ${term}\n\nThe sentence it appears in:\n${sentence}`
      : `Word: ${term}`

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}
