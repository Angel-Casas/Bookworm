/**
 * The translation layer: a key, a language, and the sentence that comes out.
 *
 * Deliberately small. Bookworm already asks `Intl` for numbers, plurals and
 * money (src/lib/format.ts), and every piece of text in the app has been
 * written to be handed in from outside rather than baked into logic. What was
 * missing was only the lookup — so that is all this is: a catalogue per
 * language, English underneath as the one that is always complete, and
 * `{placeholders}` filled from a plain object.
 *
 * The rules it lives by:
 *
 *   A missing translation is not an error. Any key a translator has not
 *   reached yet falls through to English, which is always whole, so a
 *   half-finished language is a usable app rather than a broken one.
 *
 *   Plurals are chosen by the language's OWN rules, not by `count === 1`.
 *   Polish needs three forms and Arabic six; a key can carry any of them and
 *   `other` is the one every language has.
 *
 *   Nothing here touches Vue, storage or the DOM. The component-facing wrapper
 *   is `src/i18n/index.ts`; this is the part that gets unit-tested.
 */
import { pluralCategory, type Locale } from '@/lib/format'

/** A message is either one string, or a set of forms chosen by a count. */
export type Message = string | ({ other: string } & Partial<Record<Intl.LDMLPluralRule, string>>)

/** A flat catalogue: dotted keys to messages. Flat rather than nested because
 *  a translator wants one list to work down, not a tree to navigate. */
export type Catalogue = Record<string, Message>

/** Values for `{placeholders}`. `count` is special: it also picks the plural. */
export type Params = Record<string, string | number>

const PLACEHOLDER = /\{(\w+)\}/g

/** Fill `{name}` from `params`. An unknown placeholder is left standing —
 *  visible, and far easier to spot than a silently empty gap. */
export function interpolate(text: string, params: Params | undefined): string {
  if (!params) return text
  return text.replace(PLACEHOLDER, (whole, name: string) => {
    const value = params[name]
    return value === undefined ? whole : String(value)
  })
}

/** Pick the wording a message uses for this count, in this language. */
export function selectForm(message: Message, locale: Locale, count: number | undefined): string {
  if (typeof message === 'string') return message
  if (count === undefined) return message.other
  return message[pluralCategory(count, locale)] ?? message.other
}

/**
 * Look `key` up in `catalogue`, falling back to `fallback` (English), and
 * finally to the key itself — which is ugly on purpose. A key showing through
 * in the interface is a bug report that writes itself; a blank space is not.
 */
export function translate(
  key: string,
  locale: Locale,
  catalogue: Catalogue,
  fallback: Catalogue,
  params?: Params,
): string {
  const message = catalogue[key] ?? fallback[key]
  if (message === undefined) return key
  const count = typeof params?.count === 'number' ? params.count : undefined
  return interpolate(selectForm(message, locale, count), params)
}

/**
 * Which keys a language is still missing, and which it has that English does
 * not. Used by the test that keeps the eleven catalogues honest — a key
 * renamed in English and not in the others would otherwise fall back silently
 * and forever.
 */
export function compareCatalogues(
  reference: Catalogue,
  other: Catalogue,
): { missing: string[]; extra: string[] } {
  const referenceKeys = Object.keys(reference)
  const otherKeys = new Set(Object.keys(other))
  return {
    missing: referenceKeys.filter((key) => !otherKeys.has(key)),
    extra: [...otherKeys].filter((key) => !(key in reference)),
  }
}

/** How much of the reference catalogue a language covers, 0–1. */
export function coverage(reference: Catalogue, other: Catalogue): number {
  const total = Object.keys(reference).length
  if (total === 0) return 1
  return (total - compareCatalogues(reference, other).missing.length) / total
}
