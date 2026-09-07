/**
 * The eleven catalogues, checked against each other.
 *
 * English is the reference and the only one that must be complete. What this
 * guards is the thing that goes wrong silently: a key renamed in English and
 * not in the others falls back forever, looking like a translation nobody got
 * round to rather than the bug it is. So every language is asked for the keys
 * it has that English does not — and that list must be empty.
 *
 * The placeholders are checked too. `{count}` dropped from a translation is a
 * sentence with a hole in it, and no amount of reading the English would find
 * it.
 */
import { describe, expect, it } from 'vitest'
import { LANGUAGES } from '@/lib/language'
import { compareCatalogues, coverage, type Catalogue, type Message } from '@/lib/i18n'
import en from '../messages/en'
import es from '../messages/es'
import fr from '../messages/fr'
import de from '../messages/de'
import pt from '../messages/pt'
// `it` is vitest's own; the Italian catalogue comes in under another name.
import italian from '../messages/it'
import ru from '../messages/ru'
import zh from '../messages/zh'
import ja from '../messages/ja'
import hi from '../messages/hi'
import ar from '../messages/ar'

const CATALOGUES: Record<string, Catalogue> = {
  es,
  fr,
  de,
  pt,
  it: italian,
  ru,
  zh,
  ja,
  hi,
  ar,
}
const reference = en as Catalogue

/** Every `{placeholder}` a message uses, in any of its plural forms. */
function placeholders(message: Message): Set<string> {
  const texts = typeof message === 'string' ? [message] : Object.values(message)
  const found = new Set<string>()
  for (const text of texts) {
    for (const match of String(text).matchAll(/\{(\w+)\}/g)) found.add(match[1] ?? '')
  }
  return found
}

describe('the catalogues', () => {
  it('has a file for every language the app offers', () => {
    for (const language of LANGUAGES) {
      if (language.code === 'en') continue
      expect(Object.keys(CATALOGUES)).toContain(language.code)
    }
  })

  it('has an English message for every key', () => {
    for (const [key, message] of Object.entries(reference)) {
      const forms = typeof message === 'string' ? [message] : Object.values(message)
      expect(
        forms.every((form) => String(form).length > 0),
        `en: ${key}`,
      ).toBe(true)
    }
  })

  for (const [code, catalogue] of Object.entries(CATALOGUES)) {
    describe(`${code}`, () => {
      it('has no key English does not — nothing renamed on one side only', () => {
        expect(compareCatalogues(reference, catalogue).extra).toEqual([])
      })

      it('keeps every placeholder the English message uses', () => {
        for (const [key, message] of Object.entries(catalogue)) {
          const expected = placeholders(reference[key] as Message)
          const actual = placeholders(message)
          for (const name of expected) {
            expect([...actual], `${code}: ${key} lost {${name}}`).toContain(name)
          }
        }
      })

      it('gives every plural message an "other" form', () => {
        for (const [key, message] of Object.entries(catalogue)) {
          if (typeof message === 'string') continue
          expect(typeof message.other, `${code}: ${key}`).toBe('string')
        }
      })

      it('is translated (a missing language would fall back silently)', () => {
        expect(coverage(reference, catalogue)).toBeGreaterThan(0.9)
      })
    })
  }
})
