/**
 * Translation, as a component sees it.
 *
 * `const { t } = useI18n()` and then `t('nav.settings')`. Because `t` reads
 * the language store while it runs, a template that calls it is re-rendered
 * when the reader changes language — no event, no key on the root, nothing to
 * remember.
 *
 * English is bundled; the other ten arrive as their own chunks when they are
 * wanted, which keeps a reader who only ever uses one language from
 * downloading eleven. Until a chunk lands, English stands in — the fallback in
 * `src/lib/i18n.ts` was built for exactly this moment.
 */
import { ref } from 'vue'
import type { Catalogue, Params } from '@/lib/i18n'
import { translate } from '@/lib/i18n'
import { DEFAULT_LANGUAGE } from '@/lib/language'
import { useLanguageStore } from '@/stores/language'
import en from './messages/en'

export type MessageKey = keyof typeof en

/** Everything loaded so far. Reactive: a catalogue arriving re-renders the
 *  app, which is how a language change lands without a reload. */
const catalogues = ref<Record<string, Catalogue>>({ [DEFAULT_LANGUAGE]: en })

/**
 * One importer per language. Written out rather than built from a template so
 * the bundler can see every chunk it needs to make — and so a language with no
 * file yet simply is not here.
 */
const LOADERS: Record<string, () => Promise<{ default: Catalogue }>> = {
  es: () => import('./messages/es'),
  fr: () => import('./messages/fr'),
  de: () => import('./messages/de'),
  pt: () => import('./messages/pt'),
  it: () => import('./messages/it'),
  ru: () => import('./messages/ru'),
  zh: () => import('./messages/zh'),
  ja: () => import('./messages/ja'),
  hi: () => import('./messages/hi'),
  ar: () => import('./messages/ar'),
}

const inFlight = new Map<string, Promise<void>>()

/** Fetch a language's catalogue, once. Safe to call as often as you like. */
export function loadLocale(code: string): Promise<void> {
  if (code in catalogues.value) return Promise.resolve()
  const loader = LOADERS[code]
  if (!loader) return Promise.resolve()
  let pending = inFlight.get(code)
  if (!pending) {
    pending = loader()
      .then((module) => {
        catalogues.value = { ...catalogues.value, [code]: module.default }
      })
      .catch(() => {
        // A chunk that will not load is not worth an error page: English is
        // already on screen and the app keeps working in it.
      })
      .finally(() => inFlight.delete(code))
    inFlight.set(code, pending)
  }
  return pending
}

/** Translate outside a component — stores, and the odd module-level string. */
export function translateIn(code: string, key: MessageKey, params?: Params): string {
  return translate(key, code, catalogues.value[code] ?? {}, en, params)
}

export function useI18n(): {
  t: (key: MessageKey, params?: Params) => string
} {
  const language = useLanguageStore()
  return {
    t: (key, params) => translateIn(language.code, key, params),
  }
}
