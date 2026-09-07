import { describe, expect, it } from 'vitest'
import {
  clampQuizCount,
  composeQuizPrompt,
  DEFAULT_QUIZ_SETUP,
  normalizeQuizSetup,
  QUIZ_COUNT_MAX,
  QUIZ_COUNT_MIN,
  type QuizSetup,
} from '../quiz'

const setup = (over: Partial<QuizSetup> = {}): QuizSetup => ({ ...DEFAULT_QUIZ_SETUP, ...over })

describe('clampQuizCount', () => {
  it('keeps a count inside the range', () => {
    expect(clampQuizCount(0)).toBe(QUIZ_COUNT_MIN)
    expect(clampQuizCount(999)).toBe(QUIZ_COUNT_MAX)
    expect(clampQuizCount(7)).toBe(7)
  })

  it('takes whole questions only', () => {
    expect(clampQuizCount(4.6)).toBe(5)
  })

  it('falls back rather than passing nonsense on', () => {
    expect(clampQuizCount(Number.NaN)).toBe(DEFAULT_QUIZ_SETUP.count)
  })
})

describe('normalizeQuizSetup', () => {
  it('reads a stored setup back', () => {
    expect(
      normalizeQuizSetup({ count: 10, scope: 'whole-book', kind: 'quotes', oneAtATime: false, cite: false }),
    ).toEqual({ count: 10, scope: 'whole-book', kind: 'quotes', oneAtATime: false, cite: false })
  })

  it('replaces anything it does not recognise with the default', () => {
    expect(normalizeQuizSetup({ scope: 'everything', kind: 'trick', count: 'lots' })).toEqual(
      DEFAULT_QUIZ_SETUP,
    )
    expect(normalizeQuizSetup(null)).toEqual(DEFAULT_QUIZ_SETUP)
  })
})

describe('composeQuizPrompt', () => {
  it('states how many questions, and counts them as English', () => {
    expect(composeQuizPrompt(setup({ count: 5 }))).toContain('with 5 questions')
    expect(composeQuizPrompt(setup({ count: 1 }))).toContain('with 1 question,')
  })

  it('asks for the chosen kind and no other', () => {
    const quotes = composeQuizPrompt(setup({ kind: 'quotes' }))
    expect(quotes).toContain('Quote a line')
    expect(quotes).not.toContain('Mix the kinds')

    const why = composeQuizPrompt(setup({ kind: 'why' }))
    expect(why).toContain('motives, causes')
    expect(why).not.toContain('Quote a line')
  })

  it('asks one at a time, numbered, and waits', () => {
    const prompt = composeQuizPrompt(setup({ count: 3, oneAtATime: true }))
    expect(prompt).toContain('one question at a time')
    expect(prompt).toContain('(1 of 3)')
    expect(prompt).not.toContain('all 3 questions at once')
  })

  it('or hands over the whole sheet and withholds the answers', () => {
    const prompt = composeQuizPrompt(setup({ count: 3, oneAtATime: false }))
    expect(prompt).toContain('all 3 questions at once')
    expect(prompt).toContain('do not reveal any answers')
    expect(prompt).not.toContain('one question at a time')
  })

  it('asks answers to name where they came from, only when wanted', () => {
    expect(composeQuizPrompt(setup({ cite: true }))).toContain('name the part of the reference')
    expect(composeQuizPrompt(setup({ cite: false }))).not.toContain('name the part of the reference')
  })

  it('forbids looking ahead — except when the reader has asked for the whole book', () => {
    expect(composeQuizPrompt(setup({ scope: 'section' }))).toContain('nothing from later in the book')
    expect(composeQuizPrompt(setup({ scope: 'book-so-far' }))).toContain(
      'nothing from later in the book',
    )
    // Past the whole book there is nothing left to protect.
    expect(composeQuizPrompt(setup({ scope: 'whole-book' }))).not.toContain('nothing from later')
  })

  it('clamps a bad count rather than asking for it', () => {
    expect(composeQuizPrompt(setup({ count: 500 }))).toContain(`with ${QUIZ_COUNT_MAX} questions`)
  })

  it('is deterministic', () => {
    expect(composeQuizPrompt(setup())).toBe(composeQuizPrompt(setup()))
  })
})
