/**
 * The languages Bookworm offers, and how a first-time reader's choice is
 * guessed before they make one.
 *
 * The list is flat on purpose: every language is offered the same way, and the
 * choice is simply recorded. The guess is a courtesy, not a decision — it only
 * says which row the chooser opens on, and one tap changes it.
 */

export interface Language {
  code: string
  /** The language's name IN that language: a reader looking for their own
   *  tongue is not helped by seeing it spelled the English way. */
  name: string
  /** Reading direction, for the day these are really translated. */
  rtl?: boolean
}

export const LANGUAGES: readonly Language[] = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'pt', name: 'Português' },
  { code: 'it', name: 'Italiano' },
  { code: 'ru', name: 'Русский' },
  { code: 'zh', name: '中文' },
  { code: 'ja', name: '日本語' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'ar', name: 'العربية', rtl: true },
] as const

export const DEFAULT_LANGUAGE = 'en'

export function isLanguageCode(value: unknown): value is string {
  return typeof value === 'string' && LANGUAGES.some((language) => language.code === value)
}

/** Right-to-left languages read from the other side; the whole layout mirrors
 *  for them, which is why the direction is a property of the LIST rather than
 *  something each component decides. */
export function isRtl(code: string): boolean {
  return LANGUAGES.find((language) => language.code === code)?.rtl === true
}

/** What belongs in `<html dir>`. */
export function directionOf(code: string): 'ltr' | 'rtl' {
  return isRtl(code) ? 'rtl' : 'ltr'
}

export function languageName(code: string): string {
  return LANGUAGES.find((language) => language.code === code)?.name ?? code
}

/**
 * The best guess at a reader's language from what their browser asks for.
 *
 * Region is dropped ("pt-BR" is Portuguese either way) and the list is walked
 * in the browser's own order of preference, so a reader whose first choice we
 * do not offer still gets their second. Falls back to the app's default.
 */
export function guessLanguage(preferred: readonly string[] | undefined): string {
  for (const raw of preferred ?? []) {
    if (typeof raw !== 'string') continue
    const base = raw.trim().toLowerCase().split(/[-_]/)[0]
    if (base && isLanguageCode(base)) return base
  }
  return DEFAULT_LANGUAGE
}
