import { describe, expect, it } from 'vitest'
import {
  formatCount,
  formatDuration,
  formatMoney,
  formatPercent,
  plural,
  pluralCategory,
} from '../format'

describe('plurals', () => {
  it('knows English has two forms', () => {
    expect(pluralCategory(1, 'en')).toBe('one')
    expect(pluralCategory(0, 'en')).toBe('other')
    expect(pluralCategory(2, 'en')).toBe('other')
  })

  it('knows other languages have more', () => {
    // Polish: 1 / 2-4 / 5+ are three different words. A ternary cannot say this,
    // which is the whole reason this file exists.
    expect(pluralCategory(1, 'pl')).toBe('one')
    expect(pluralCategory(3, 'pl')).toBe('few')
    expect(pluralCategory(7, 'pl')).toBe('many')
  })

  it('picks the wording for a count', () => {
    const forms = { one: 'page turn', other: 'page turns' }
    expect(plural(1, 'en', forms)).toBe('page turn')
    expect(plural(4, 'en', forms)).toBe('page turns')
  })

  it('falls back to "other" for a form nobody wrote', () => {
    // A translator who filled in only the required form still gets a sentence.
    expect(plural(3, 'pl', { other: 'stron' })).toBe('stron')
  })

  it('survives a locale it has never heard of', () => {
    expect(() => pluralCategory(2, 'not-a-locale')).not.toThrow()
    expect(plural(1, 'not-a-locale', { one: 'book', other: 'books' })).toBe('book')
  })
})

describe('formatCount', () => {
  it('groups digits the way the reader does', () => {
    expect(formatCount(1234, 'en')).toBe('1,234')
    expect(formatCount(1234, 'de')).toBe('1.234')
    expect(formatCount(1234, 'fr')).toMatch(/1.234/)
  })

  it('says nothing about a number that is not one', () => {
    expect(formatCount(Number.NaN, 'en')).toBe('')
  })
})

describe('formatPercent', () => {
  it('is whole percents in the reader’s own numerals', () => {
    expect(formatPercent(0.256, 'en')).toBe('26%')
    expect(formatPercent(1, 'en')).toBe('100%')
  })

  it('never rounds a started book to nothing, nor an unfinished one to done', () => {
    expect(formatPercent(0.001, 'en')).toBe('1%')
    expect(formatPercent(0.999, 'en')).toBe('99%')
  })

  it('shows nothing when there is nothing to show', () => {
    expect(formatPercent(null, 'en')).toBe('')
    expect(formatPercent(undefined, 'en')).toBe('')
  })
})

describe('formatMoney', () => {
  it('keeps sub-cent precision for the small sums an LLM costs', () => {
    expect(formatMoney(0.0000123, 'en-US')).toBe('$0.000012')
    expect(formatMoney(0.0042, 'en-US')).toBe('$0.0042')
    expect(formatMoney(1.5, 'en-US')).toBe('$1.50')
  })

  it('puts the sign where the reader’s language puts it', () => {
    // German writes "1,50 $" — sign after, comma for the decimal.
    const german = formatMoney(1.5, 'de-DE')
    expect(german).toMatch(/1,50/)
    expect(german.trim().endsWith('$')).toBe(true)
  })

  it('has a dash for what it cannot price', () => {
    expect(formatMoney(null, 'en')).toBe('—')
    expect(formatMoney(-1, 'en')).toBe('—')
  })
})

describe('formatDuration', () => {
  it('is compact', () => {
    expect(formatDuration(45, 'en')).toBe('<1m')
    expect(formatDuration(60 * 45, 'en')).toBe('45m')
    expect(formatDuration(60 * 60 * 3, 'en')).toBe('3h')
    expect(formatDuration(60 * 60 * 3 + 60 * 12, 'en')).toBe('3h 12m')
  })

  it('takes its units as words, so a translator can replace them', () => {
    const spanish = { hour: ' h', minute: ' min', underAMinute: '<1 min', unknown: '—' }
    expect(formatDuration(60 * 60 * 2 + 60 * 5, 'es', spanish)).toBe('2 h 5 min')
    expect(formatDuration(10, 'es', spanish)).toBe('<1 min')
  })

  it('has a dash for a duration that makes no sense', () => {
    expect(formatDuration(Number.NaN, 'en')).toBe('—')
    expect(formatDuration(-5, 'en')).toBe('—')
  })
})
