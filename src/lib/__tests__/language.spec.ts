import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  directionOf,
  guessLanguage,
  isLanguageCode,
  isRtl,
  languageName,
} from '../language'

describe('the language list', () => {
  it('names every language in its own words', () => {
    expect(languageName('es')).toBe('Español')
    expect(languageName('ja')).toBe('日本語')
  })

  it('has no duplicate codes', () => {
    const codes = LANGUAGES.map((language) => language.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('knows which codes it offers', () => {
    expect(isLanguageCode('fr')).toBe(true)
    expect(isLanguageCode('klingon')).toBe(false)
    expect(isLanguageCode(null)).toBe(false)
  })

  it('offers the default among them', () => {
    expect(isLanguageCode(DEFAULT_LANGUAGE)).toBe(true)
  })

  it('knows which languages read from the other side', () => {
    expect(isRtl('ar')).toBe(true)
    expect(isRtl('en')).toBe(false)
    expect(directionOf('ar')).toBe('rtl')
    expect(directionOf('ja')).toBe('ltr')
    // Not a language we offer: left-to-right is the safe assumption.
    expect(directionOf('xx')).toBe('ltr')
  })

  it('falls back to the code itself for a name it does not have', () => {
    expect(languageName('xx')).toBe('xx')
  })
})

describe('guessLanguage', () => {
  it('drops the region', () => {
    expect(guessLanguage(['pt-BR'])).toBe('pt')
    expect(guessLanguage(['es-419'])).toBe('es')
    expect(guessLanguage(['ZH_hans'])).toBe('zh')
  })

  it('walks the browser’s own order of preference', () => {
    // Their first choice is one we do not offer; their second is.
    expect(guessLanguage(['cy', 'fr-FR', 'en'])).toBe('fr')
  })

  it('falls back to the default', () => {
    expect(guessLanguage([])).toBe(DEFAULT_LANGUAGE)
    expect(guessLanguage(undefined)).toBe(DEFAULT_LANGUAGE)
    expect(guessLanguage(['cy', 'eu'])).toBe(DEFAULT_LANGUAGE)
  })

  it('ignores junk in the list', () => {
    expect(guessLanguage([undefined as unknown as string, '', 'de'])).toBe('de')
  })
})
