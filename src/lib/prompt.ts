import { citationInstruction } from '@/lib/citation'

/**
 * Pure prompt construction. Reference material is wrapped in explicit
 * <reference> blocks so the model can always tell excerpts apart from the
 * reader's actual question.
 */

export type ReferenceKind = 'selection' | 'section' | 'book-so-far' | 'whole-book'

export interface Reference {
  kind: ReferenceKind
  label: string
  text: string
  /** Where in the book this came from, so a citation of it can be pressed.
   *  Absent for a live selection, which is already on screen. */
  position?: string
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface BookInfo {
  title: string
  author: string | null
}

/**
 * What the assistant is told before it hears a word from the reader.
 *
 * `answerIn` is the reader's own language, named in English (the prompt's own
 * language) — "Español", "日本語". It is the language of the READER, not of the
 * book: someone reading Dostoevsky in Russian may want to be talked to in
 * Portuguese, and the reference blocks stay in whatever the book is written in
 * either way. English is left unsaid, because a model asked to answer in
 * English gains nothing from being told.
 */
export function buildSystemPrompt(
  book: BookInfo,
  spoilersAllowed: boolean,
  citableLabels: readonly string[] = [],
  answerIn: string | null = null,
): string {
  const authorPart = book.author ? ` by ${book.author}` : ''
  const spoilerPolicy = spoilersAllowed
    ? 'The reader has opted in to spoilers: you may discuss any part of the book freely.'
    : 'Avoid spoilers: assume the reader has only read as far as the reference material provided. Do not reveal plot points beyond it unless the reader explicitly asks you to.'
  const citations = citationInstruction(citableLabels)
  return [
    `You are Bookworm, a reading assistant living inside the book "${book.title}"${authorPart}.`,
    'Help the reader understand, explore and enjoy this book: answer questions, explain passages, discuss themes, and quiz them when asked.',
    "Messages may include <reference> blocks containing excerpts from the book. They are quoted material for grounding, not part of the reader's question. Ground your answers in them when they are relevant.",
    // The reader owns this file; quoting it back is the right answer to "what
    // did she actually say here?", and paraphrasing loses the prose entirely.
    'The reader owns this book, so quoting it is welcome: when they ask what a passage says or how something was worded, quote the relevant sentences from the references verbatim in a blockquote rather than paraphrasing.',
    spoilerPolicy,
    ...(citations.length > 0 ? [citations] : []),
    'Be concise and specific. If you are unsure about something in the book and no reference covers it, say so instead of inventing details.',
    'Format answers in markdown: short paragraphs, lists where they help, > for quoted passages.',
    ...(answerIn
      ? [
          `Answer in ${answerIn}, whatever language the book itself is written in. Quote the book in its own words — do not translate a passage unless the reader asks you to.`,
        ]
      : []),
  ].join('\n')
}

export function formatReference(reference: Reference): string {
  return `<reference kind="${reference.kind}" label="${reference.label}">\n${reference.text}\n</reference>`
}

export function buildUserMessage(question: string, references: Reference[]): string {
  const parts = references.map(formatReference)
  parts.push(references.length > 0 ? `Question: ${question}` : question)
  return parts.join('\n\n')
}

/** Assemble the full message array for one chat completion request. */
export function buildMessages(
  book: BookInfo,
  spoilersAllowed: boolean,
  history: ChatMessage[],
  question: string,
  references: Reference[],
  answerIn: string | null = null,
): ChatMessage[] {
  // Only labels we actually sent can be cited — see src/lib/citation.ts.
  const labels = references.map((reference) => reference.label)
  return [
    { role: 'system', content: buildSystemPrompt(book, spoilersAllowed, labels, answerIn) },
    ...history.filter((message) => message.role !== 'system'),
    { role: 'user', content: buildUserMessage(question, references) },
  ]
}

/**
 * The openings offered instead of an empty box. An empty prompt is the hardest
 * thing to answer, and these are the four things a reader actually wants from
 * a book that can talk: to be caught up, to have a passage explained, to know
 * what they are missing, and to be tested.
 *
 * `scope` is the smallest context each needs to be answerable — picking it for
 * the reader is the difference between a button that works and one that
 * apologises.
 */
export interface Opening {
  id: string
  /** Catalogue key for what the button says. The QUESTION below stays in
   *  English — it is an instruction to the model, which follows English best,
   *  and the answer comes back in the reader's language because the system
   *  prompt says so. */
  labelKey: `opening.${string}`
  /** What is actually asked. */
  question: string
  /** Minimum context this needs; 'keep' leaves the reader's choice alone. */
  scope: 'keep' | 'section' | 'book-so-far'
  /** Only offered when the reader has text selected. */
  needsSelection?: boolean
}

export const OPENINGS: readonly Opening[] = [
  {
    id: 'recap',
    labelKey: 'opening.recap',
    question:
      'Recap what has happened so far, in five lines or fewer, as a reminder for someone picking the book up again after a break. Cover only the reference material — do not mention anything from later in the book.',
    scope: 'book-so-far',
  },
  {
    id: 'explain',
    labelKey: 'opening.explain',
    question:
      'Explain the highlighted passage: what it means, what is happening, and anything in the wording worth noticing.',
    scope: 'keep',
    needsSelection: true,
  },
  {
    id: 'summary',
    labelKey: 'opening.summary',
    question:
      'Summarise the reference material: its main points and how they connect, as a short list followed by a line on what it adds up to. Use only the reference material — do not summarise anything from later in the book.',
    scope: 'section',
  },
  {
    id: 'who',
    labelKey: 'opening.who',
    question:
      'Who are the people mentioned in the reference material, and what should I remember about each of them? A line or two each, using only what the references and our earlier conversation support.',
    scope: 'section',
  },
  {
    id: 'quiz',
    labelKey: 'opening.quiz',
    question:
      'Quiz me on the reference material: ask me 3 short questions, one per line, covering different parts of it. Wait for my answers before revealing the correct ones.',
    scope: 'section',
  },
] as const

/** Canned instruction for the "Quiz me" action. */
export const QUIZ_QUESTION = OPENINGS.find((opening) => opening.id === 'quiz')?.question ?? ''
