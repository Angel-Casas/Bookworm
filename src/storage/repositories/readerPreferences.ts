import {
  DEFAULT_READER_PREFERENCES,
  type ReaderFontFamily,
  type ReaderMode,
  type ReaderPreferences,
  type ReaderTheme,
} from '@/domain/reader';
import type { BookwormDB } from '../db/open';
import { READER_PREFERENCES_STORE, type ReaderPreferencesRecord } from '../db/schema';

export type ReaderPreferencesRepository = {
  get(): Promise<ReaderPreferences>;
  put(prefs: ReaderPreferences): Promise<void>;
};

const VALID_THEMES: ReadonlySet<ReaderTheme> = new Set(['light', 'dark', 'sepia']);
const VALID_MODES: ReadonlySet<ReaderMode> = new Set(['scroll', 'paginated']);
const VALID_FONTS: ReadonlySet<ReaderFontFamily> = new Set([
  'system-serif',
  'system-sans',
  'georgia',
  'iowan',
  'inter',
]);

function isValid(value: unknown): value is ReaderPreferences {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<ReaderPreferences>;
  if (!v.theme || !VALID_THEMES.has(v.theme)) return false;
  if (!v.modeByFormat || !VALID_MODES.has(v.modeByFormat.epub)) return false;
  if (!v.typography) return false;
  const t = v.typography;
  if (!VALID_FONTS.has(t.fontFamily)) return false;
  if (!Number.isInteger(t.fontSizeStep) || t.fontSizeStep < 0 || t.fontSizeStep > 4) return false;
  if (!Number.isInteger(t.lineHeightStep) || t.lineHeightStep < 0 || t.lineHeightStep > 2) {
    return false;
  }
  if (!Number.isInteger(t.marginStep) || t.marginStep < 0 || t.marginStep > 2) return false;
  return true;
}

export function createReaderPreferencesRepository(db: BookwormDB): ReaderPreferencesRepository {
  return {
    async get() {
      const rec = await db.get(READER_PREFERENCES_STORE, 'global');
      if (!rec) return DEFAULT_READER_PREFERENCES;
      if (!isValid(rec.value)) {
        console.warn('[readerPreferences] dropping corrupted record');
        await db.delete(READER_PREFERENCES_STORE, 'global');
        return DEFAULT_READER_PREFERENCES;
      }
      return rec.value;
    },
    async put(prefs) {
      const record: ReaderPreferencesRecord = { key: 'global', value: prefs };
      await db.put(READER_PREFERENCES_STORE, record);
    },
  };
}
