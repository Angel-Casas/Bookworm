import { describe, expect, it } from 'vitest'
import { compareCatalogues, coverage, interpolate, selectForm, translate } from '../i18n'
import type { Catalogue } from '../i18n'

const EN: Catalogue = {
  greeting: 'Hello',
  named: 'Hello, {name}',
  marks: { one: '{count} mark', other: '{count} marks' },
}

const ES: Catalogue = {
  greeting: 'Hola',
  marks: { one: '{count} marca', other: '{count} marcas' },
}

describe('interpolate', () => {
  it('fills a placeholder', () => {
    expect(interpolate('Hello, {name}', { name: 'Angel' })).toBe('Hello, Angel')
  })

  it('leaves a placeholder nobody filled standing', () => {
    // Visible, and far easier to spot than a silently empty gap.
    expect(interpolate('Hello, {name}', {})).toBe('Hello, {name}')
  })

  it('does the same value twice if the sentence asks twice', () => {
    expect(interpolate('{a} and {a}', { a: 'one' })).toBe('one and one')
  })
})

describe('selectForm', () => {
  it('picks by the language’s own plural rules, not by count === 1', () => {
    const polish = { one: 'strona', few: 'strony', many: 'stron', other: 'strony' }
    expect(selectForm(polish, 'pl', 1)).toBe('strona')
    expect(selectForm(polish, 'pl', 3)).toBe('strony')
    expect(selectForm(polish, 'pl', 7)).toBe('stron')
  })

  it('falls back to "other" for a form nobody wrote', () => {
    expect(selectForm({ other: 'stron' }, 'pl', 3)).toBe('stron')
  })

  it('leaves a plain string alone', () => {
    expect(selectForm('Hello', 'en', 5)).toBe('Hello')
  })
})

describe('translate', () => {
  it('reads from the language’s own catalogue', () => {
    expect(translate('greeting', 'es', ES, EN)).toBe('Hola')
  })

  it('falls through to English for a key the translator has not reached', () => {
    // A half-finished language is a usable app, not a broken one.
    expect(translate('named', 'es', ES, EN, { name: 'Angel' })).toBe('Hello, Angel')
  })

  it('shows the key itself when nobody has the string', () => {
    // Ugly on purpose: a key showing through is a bug report that writes
    // itself, where a blank space is a mystery.
    expect(translate('nothing.here', 'es', ES, EN)).toBe('nothing.here')
  })

  it('pluralises in the reader’s language, from `count`', () => {
    expect(translate('marks', 'es', ES, EN, { count: 1 })).toBe('1 marca')
    expect(translate('marks', 'es', ES, EN, { count: 4 })).toBe('4 marcas')
  })

  it('pluralises a FALLEN-BACK message by the reader’s rules too', () => {
    // The English words with Polish's choice of form is the best that can be
    // done, and it is better than always taking 'other'.
    const pl: Catalogue = {}
    expect(translate('marks', 'pl', pl, EN, { count: 1 })).toBe('1 mark')
    expect(translate('marks', 'pl', pl, EN, { count: 5 })).toBe('5 marks')
  })
})

describe('compareCatalogues', () => {
  it('names what a language is missing', () => {
    expect(compareCatalogues(EN, ES).missing).toEqual(['named'])
  })

  it('names what it has that English does not — a key renamed on one side', () => {
    expect(compareCatalogues(EN, { ...ES, stale: 'x' }).extra).toEqual(['stale'])
  })

  it('measures how far along a language is', () => {
    expect(coverage(EN, ES)).toBeCloseTo(2 / 3)
    expect(coverage(EN, EN)).toBe(1)
    expect(coverage(EN, {})).toBe(0)
  })
})
