/**
 * Numbers, plurals and money, shaped for a reader in any language.
 *
 * Every one of these used to be built by hand — `${minutes}m`, a ternary for
 * "page turn"/"page turns", `toFixed(2)` with a dollar sign welded on. That is
 * fine in one language and wrong in the next: Polish has three plural forms,
 * German writes 1.234,56, and a currency symbol does not always go in front.
 *
 * So every function here takes the reader's language and asks `Intl` rather
 * than deciding for itself. Translating the app then means writing WORDS —
 * which is a translator's job — instead of rewriting arithmetic, which is not.
 *
 * The words themselves still live at the call site today. When the message
 * catalogue arrives it can hand them in: these signatures are already the
 * shape a catalogue wants.
 */

/** Pure formatting: the caller passes the language, nothing is read from a store. */
export type Locale = string

/** The plural category `count` takes in `locale` — 'one', 'other', and in some
 *  languages 'few', 'many', 'two' or 'zero'. */
export function pluralCategory(count: number, locale: Locale): Intl.LDMLPluralRule {
  try {
    return new Intl.PluralRules(locale).select(count)
  } catch {
    // An unknown locale is not worth an exception; English rules are a fair
    // guess and the caller always has an 'other' form.
    return count === 1 ? 'one' : 'other'
  }
}

/**
 * Pick the right wording for a count. Forms are given by plural category, and
 * 'other' is required — every language has it, and it is the fallback for any
 * category a translator did not fill in.
 */
export function plural(
  count: number,
  locale: Locale,
  forms: { other: string } & Partial<Record<Intl.LDMLPluralRule, string>>,
): string {
  return forms[pluralCategory(count, locale)] ?? forms.other
}

/** A plain number in the reader's own digits and grouping: 1,234 / 1.234 / ١٢٣٤. */
export function formatCount(value: number, locale: Locale): string {
  if (!Number.isFinite(value)) return ''
  try {
    return new Intl.NumberFormat(locale).format(value)
  } catch {
    return String(value)
  }
}

/**
 * A percentage, whole numbers only — and never a rounded 0% or 100%: a reader
 * who has started deserves better than "0%", and one with a page left is not
 * done. (The rule the shelf's progress bars were already using; it lives here
 * now so it is stated once.)
 */
export function formatPercent(fraction: number | null | undefined, locale: Locale): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return ''
  const clamped = Math.min(1, Math.max(0, fraction))
  let percent = Math.round(clamped * 100)
  if (percent === 0 && clamped > 0) percent = 1
  if (percent === 100 && clamped < 1) percent = 99
  try {
    return new Intl.NumberFormat(locale, { style: 'percent' }).format(percent / 100)
  } catch {
    return `${percent}%`
  }
}

/**
 * Money. LLM costs run to millionths of a dollar, so the fraction digits are
 * chosen by size rather than fixed at two — but the SHAPE of the number, and
 * where the currency sign goes, belong to the reader's language.
 */
export function formatMoney(amount: number | null, locale: Locale, currency = 'USD'): string {
  if (amount === null || !Number.isFinite(amount) || amount < 0) return '—'
  const digits = amount === 0 || amount >= 0.1 ? 2 : amount >= 0.001 ? 4 : 6
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount)
  } catch {
    return `$${amount.toFixed(digits)}`
  }
}

export interface DurationWords {
  /** e.g. "h" — appended to a number of hours. */
  hour: string
  /** e.g. "m" — appended to a number of minutes. */
  minute: string
  /** Shown for anything under a minute, e.g. "<1m". */
  underAMinute: string
  /** Shown when the duration makes no sense at all. */
  unknown: string
}

const ENGLISH_DURATION: DurationWords = {
  hour: 'h',
  minute: 'm',
  underAMinute: '<1m',
  unknown: '—',
}

/**
 * A reading duration, compact: "3h 12m", "45m", "<1m".
 *
 * The numbers come from Intl; the units are words, so they are handed in. The
 * default is English, which is what the app speaks today — a translator
 * replaces the four words rather than this arithmetic.
 */
export function formatDuration(
  seconds: number,
  locale: Locale = 'en',
  words: DurationWords = ENGLISH_DURATION,
): string {
  if (!Number.isFinite(seconds) || seconds < 0) return words.unknown
  if (seconds < 60) return words.underAMinute
  const totalMinutes = Math.floor(seconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  const h = `${formatCount(hours, locale)}${words.hour}`
  const m = `${formatCount(minutes, locale)}${words.minute}`
  if (hours === 0) return m
  return minutes === 0 ? h : `${h} ${m}`
}
