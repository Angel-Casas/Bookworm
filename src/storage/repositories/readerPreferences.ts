import {
  DEFAULT_READER_PREFERENCES,
  type FocusMode,
  type ReaderFontFamily,
  type ReaderMode,
  type ReaderPreferences,
  type ReaderTheme,
  type ReaderTypography,
} from '@/domain/reader';
import type { BookwormDB } from '../db/open';
import { READER_PREFERENCES_STORE, type ReaderPreferencesRecord } from '../db/schema';

export type ReaderPreferencesRepository = {
  get(): Promise<ReaderPreferences>;
  put(prefs: ReaderPreferences): Promise<void>;
};

const VALID_THEMES: ReadonlySet<string> = new Set(['light', 'dark', 'sepia']);
const VALID_MODES: ReadonlySet<string> = new Set(['scroll', 'paginated']);
const VALID_FONTS: ReadonlySet<string> = new Set([
  'system-serif',
  'system-sans',
  'georgia',
  'iowan',
  'inter',
]);
const VALID_FOCUS_MODES: ReadonlySet<string> = new Set(['normal', 'focus']);

function isValidTheme(v: unknown): v is ReaderTheme {
  return typeof v === 'string' && VALID_THEMES.has(v);
}
function isValidMode(v: unknown): v is ReaderMode {
  return typeof v === 'string' && VALID_MODES.has(v);
}
function isValidFont(v: unknown): v is ReaderFontFamily {
  return typeof v === 'string' && VALID_FONTS.has(v);
}
function isFontSizeStep(v: unknown): v is 0 | 1 | 2 | 3 | 4 {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 4;
}
function isLineOrMarginStep(v: unknown): v is 0 | 1 | 2 {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 2;
}
function isValidFocusMode(v: unknown): v is FocusMode {
  return typeof v === 'string' && VALID_FOCUS_MODES.has(v);
}

type LoosePreferences = {
  typography?: Partial<ReaderTypography>;
  theme?: unknown;
  modeByFormat?: { epub?: unknown; pdf?: unknown };
  focusMode?: unknown;
};

function normalize(value: unknown): ReaderPreferences | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as LoosePreferences;
  if (!isValidTheme(v.theme)) return null;
  if (!v.typography) return null;
  const t = v.typography;
  if (!isValidFont(t.fontFamily)) return null;
  if (!isFontSizeStep(t.fontSizeStep)) return null;
  if (!isLineOrMarginStep(t.lineHeightStep)) return null;
  if (!isLineOrMarginStep(t.marginStep)) return null;
  if (!v.modeByFormat) return null;

  const epub = isValidMode(v.modeByFormat.epub)
    ? v.modeByFormat.epub
    : DEFAULT_READER_PREFERENCES.modeByFormat.epub;
  const pdf = isValidMode(v.modeByFormat.pdf)
    ? v.modeByFormat.pdf
    : DEFAULT_READER_PREFERENCES.modeByFormat.pdf;
  const focusMode = isValidFocusMode(v.focusMode)
    ? v.focusMode
    : DEFAULT_READER_PREFERENCES.focusMode;

  return {
    typography: {
      fontFamily: t.fontFamily,
      fontSizeStep: t.fontSizeStep,
      lineHeightStep: t.lineHeightStep,
      marginStep: t.marginStep,
    },
    theme: v.theme,
    modeByFormat: { epub, pdf },
    focusMode,
  };
}

export function createReaderPreferencesRepository(db: BookwormDB): ReaderPreferencesRepository {
  return {
    async get() {
      const rec = await db.get(READER_PREFERENCES_STORE, 'global');
      if (!rec) return DEFAULT_READER_PREFERENCES;
      const normalized = normalize(rec.value);
      if (!normalized) {
        console.warn('[readerPreferences] dropping unrecognizable record');
        await db.delete(READER_PREFERENCES_STORE, 'global');
        return DEFAULT_READER_PREFERENCES;
      }
      // If normalize had to fill in defaults, persist the upgraded shape so
      // later reads don't repeat the work.
      if (JSON.stringify(normalized) !== JSON.stringify(rec.value)) {
        await db.put(READER_PREFERENCES_STORE, { key: 'global', value: normalized });
      }
      return normalized;
    },
    async put(prefs) {
      const record: ReaderPreferencesRecord = { key: 'global', value: prefs };
      await db.put(READER_PREFERENCES_STORE, record);
    },
  };
}
