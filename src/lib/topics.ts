/**
 * Topics: the shelves a reader sorts their books onto.
 *
 * A topic is a name, nothing more. A book carries the names of every shelf it
 * stands on — Frankenstein can be Fiction AND Gothic — and the reader's own
 * list of shelves keeps the order they chose, plus any shelf they made before
 * putting a book on it.
 *
 * Names are compared without regard to case or stray spaces, so "gothic " and
 * "Gothic" are one shelf, spelled the way it was first written.
 */
import type { BookMeta } from './types'

/** Long enough for "Nineteenth-century Russian novels", short enough for a label. */
export const MAX_TOPIC_LENGTH = 40
/** Suggestions from a book's own file, at most. */
export const MAX_SUGGESTIONS = 4

/** The name as it should be stored, or null when there is nothing to store. */
export function normalizeTopic(raw: string): string | null {
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_TOPIC_LENGTH).trim()
  return name.length > 0 ? name : null
}

/** The key two names are compared by. */
export function topicKey(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLocaleLowerCase()
}

export function sameTopic(a: string, b: string): boolean {
  return topicKey(a) === topicKey(b)
}

export function hasTopic(book: Pick<BookMeta, 'topics'>, name: string): boolean {
  return (book.topics ?? []).some((topic) => sameTopic(topic, name))
}

/** A topic list with duplicates and blanks removed, first spelling kept. */
export function uniqueTopics(names: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of names) {
    const name = normalizeTopic(raw)
    if (name === null) continue
    const key = topicKey(name)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

/**
 * Every shelf, in the order to show them.
 *
 * The reader's own list first, as they arranged it; then any topic a book
 * carries that the list does not know (one restored from an older backup, say),
 * alphabetically, so nothing a book claims is ever invisible.
 */
export function allTopics(
  books: readonly Pick<BookMeta, 'topics'>[],
  order: readonly string[],
): string[] {
  const listed = uniqueTopics(order)
  const known = new Set(listed.map(topicKey))
  const extra = uniqueTopics(books.flatMap((book) => book.topics ?? [])).filter(
    (name) => !known.has(topicKey(name)),
  )
  extra.sort((a, b) => a.localeCompare(b))
  return [...listed, ...extra]
}

export interface TopicShelf<T> {
  /** The shelf's name, or null for the books on no shelf at all. */
  topic: string | null
  books: T[]
}

/**
 * The books, shelf by shelf.
 *
 * A book appears on EVERY shelf it carries — that is what a topic is for. The
 * books keep the order they arrive in, so the caller's sort holds on every
 * shelf. Empty shelves are kept (a shelf made a moment ago, waiting for its
 * first book); the books on no shelf come last, and only if there are any.
 */
export function groupByTopic<T extends Pick<BookMeta, 'topics'>>(
  books: readonly T[],
  topics: readonly string[],
): TopicShelf<T>[] {
  const shelves: TopicShelf<T>[] = topics.map((topic) => ({
    topic,
    books: books.filter((book) => hasTopic(book, topic)),
  }))
  const keys = new Set(topics.map(topicKey))
  const loose = books.filter(
    (book) => !(book.topics ?? []).some((name) => keys.has(topicKey(name))),
  )
  if (loose.length > 0) shelves.push({ topic: null, books: loose })
  return shelves
}

/** A book's topics with one added (kept if already there). */
export function withTopic(topics: readonly string[] | undefined, name: string): string[] {
  return uniqueTopics([...(topics ?? []), name])
}

/** A book's topics with one taken off. */
export function withoutTopic(topics: readonly string[] | undefined, name: string): string[] {
  return (topics ?? []).filter((topic) => !sameTopic(topic, name))
}

/** A book's topics with one shelf renamed. */
export function renamedTopic(
  topics: readonly string[] | undefined,
  from: string,
  to: string,
): string[] {
  return uniqueTopics((topics ?? []).map((topic) => (sameTopic(topic, from) ? to : topic)))
}

/** The reader's shelf list with one renamed in place. */
export function renameInOrder(order: readonly string[], from: string, to: string): string[] {
  return uniqueTopics(order.map((topic) => (sameTopic(topic, from) ? to : topic)))
}

/**
 * What a book's own file says it is about, as shelf names to offer.
 *
 * EPUB `dc:subject` and PDF Subject/Keywords are written by publishers and
 * converters, and look it: "FICTION / Classics", "Horror tales; Science
 * fiction", library call numbers. So: split on the usual separators, drop
 * anything that is mostly digits or too long to be a label, tidy the case of
 * SHOUTING entries, and never offer a shelf the book is already on.
 */
export function topicSuggestions(
  raw: readonly string[],
  current: readonly string[] = [],
): string[] {
  const pieces = raw
    .flatMap((entry) => entry.split(/[;,/|>]|\s--\s|\n/))
    .map((piece) => piece.replace(/\s+/g, ' ').trim())
    .filter((piece) => piece.length >= 3 && piece.length <= MAX_TOPIC_LENGTH)
    .filter((piece) => (piece.match(/\d/g)?.length ?? 0) <= piece.length / 3)
    .map((piece) => (piece === piece.toUpperCase() ? titleCase(piece) : piece))
  const taken = new Set(current.map(topicKey))
  return uniqueTopics(pieces)
    .filter((name) => !taken.has(topicKey(name)))
    .slice(0, MAX_SUGGESTIONS)
}

function titleCase(text: string): string {
  return text
    .toLocaleLowerCase()
    .replace(
      /(^|\s)(\p{L})/gu,
      (_match, space: string, letter: string) => space + letter.toLocaleUpperCase(),
    )
}
