/**
 * Setting up a quiz.
 *
 * "Quiz me" used to send one canned sentence: three questions, on this
 * chapter, take it or leave it. But a quiz is the one thing a reader has
 * opinions about before it starts — how many, over how much of the book, and
 * whether they want to be asked what happened or why it happened.
 *
 * This file turns those choices into the instruction that is actually sent.
 * It is pure and it is the whole prompt: the sheet shows the reader exactly
 * this text, and anything they type over it is what goes to the model. A
 * setup panel that composed something the reader could not see would be a
 * worse version of the single canned sentence.
 */

export type QuizScope = 'section' | 'book-so-far' | 'whole-book'
export type QuizKind = 'recall' | 'why' | 'quotes' | 'mixed'

export interface QuizSetup {
  count: number
  scope: QuizScope
  kind: QuizKind
  /** Ask one, mark it, then the next — rather than handing over a worksheet. */
  oneAtATime: boolean
  /** Name the passage each answer rests on, so a wrong answer is a page to turn to. */
  cite: boolean
}

export const QUIZ_COUNT_MIN = 1
export const QUIZ_COUNT_MAX = 20

export const DEFAULT_QUIZ_SETUP: QuizSetup = {
  count: 5,
  scope: 'section',
  kind: 'mixed',
  oneAtATime: true,
  cite: true,
}

/** The counts worth one tap; any number in range can still be typed. */
export const QUIZ_COUNTS: readonly number[] = [3, 5, 10] as const

/** The choices, named by catalogue key: the words live in src/i18n. */
export const QUIZ_SCOPES: readonly {
  id: QuizScope
  labelKey: `quiz.${string}`
  hintKey: `quiz.${string}`
}[] = [
  { id: 'section', labelKey: 'quiz.scopeSection', hintKey: 'quiz.scopeSectionHint' },
  { id: 'book-so-far', labelKey: 'quiz.scopeSoFar', hintKey: 'quiz.scopeSoFarHint' },
  { id: 'whole-book', labelKey: 'quiz.scopeWhole', hintKey: 'quiz.scopeWholeHint' },
] as const

export const QUIZ_KINDS: readonly {
  id: QuizKind
  labelKey: `quiz.${string}`
  hintKey: `quiz.${string}`
}[] = [
  { id: 'recall', labelKey: 'quiz.kindRecall', hintKey: 'quiz.kindRecallHint' },
  { id: 'why', labelKey: 'quiz.kindWhy', hintKey: 'quiz.kindWhyHint' },
  { id: 'quotes', labelKey: 'quiz.kindQuotes', hintKey: 'quiz.kindQuotesHint' },
  { id: 'mixed', labelKey: 'quiz.kindMixed', hintKey: 'quiz.kindMixedHint' },
] as const

const KIND_INSTRUCTION: Record<QuizKind, string> = {
  recall: 'Ask about what happens: events, who does what, and the order things occur in.',
  why: 'Ask why: motives, causes, consequences, and what a passage implies rather than states outright.',
  quotes:
    'Quote a line from the reference material verbatim in each question and ask me to place it — who says it, who it is about, or where it falls.',
  mixed:
    'Mix the kinds: some questions about what happens, some about why, and at least one that quotes a line and asks me to place it.',
}

/** Keep a typed count inside the range, and a whole number. */
export function clampQuizCount(count: number): number {
  if (!Number.isFinite(count)) return DEFAULT_QUIZ_SETUP.count
  return Math.min(QUIZ_COUNT_MAX, Math.max(QUIZ_COUNT_MIN, Math.round(count)))
}

/** Read a setup back from storage, taking only what is valid. */
export function normalizeQuizSetup(value: unknown): QuizSetup {
  const raw = (value ?? {}) as Partial<QuizSetup>
  const scope = QUIZ_SCOPES.some((entry) => entry.id === raw.scope)
    ? (raw.scope as QuizScope)
    : DEFAULT_QUIZ_SETUP.scope
  const kind = QUIZ_KINDS.some((entry) => entry.id === raw.kind)
    ? (raw.kind as QuizKind)
    : DEFAULT_QUIZ_SETUP.kind
  return {
    count: clampQuizCount(typeof raw.count === 'number' ? raw.count : DEFAULT_QUIZ_SETUP.count),
    scope,
    kind,
    oneAtATime:
      typeof raw.oneAtATime === 'boolean' ? raw.oneAtATime : DEFAULT_QUIZ_SETUP.oneAtATime,
    cite: typeof raw.cite === 'boolean' ? raw.cite : DEFAULT_QUIZ_SETUP.cite,
  }
}

/**
 * The instruction the model receives. Written as the reader would say it, in
 * whole sentences, because it is shown to them in an editable box — a prompt
 * built out of keywords would be unreadable and so uneditable.
 */
export function composeQuizPrompt(setup: QuizSetup): string {
  const count = clampQuizCount(setup.count)
  const lines: string[] = [
    `Quiz me on the reference material with ${count} ${count === 1 ? 'question' : 'questions'}, covering different parts of it.`,
    KIND_INSTRUCTION[setup.kind],
  ]

  lines.push(
    setup.oneAtATime
      ? `Ask one question at a time and number it (1 of ${count}). Wait for my answer, tell me whether I was right and why in a line or two, then ask the next one.`
      : `Ask all ${count} questions at once, numbered, then stop and wait — do not reveal any answers until I have replied.`,
  )

  if (setup.cite) {
    lines.push(
      'When you tell me an answer, name the part of the reference material it comes from, so I can turn back to it.',
    )
  }

  // Scope is the spoiler decision (see ChatOverlay); past the whole book there
  // is nothing left to protect, so the warning would be noise.
  if (setup.scope !== 'whole-book') {
    lines.push('Ask only about the reference material — nothing from later in the book.')
  }

  return lines.join('\n')
}
