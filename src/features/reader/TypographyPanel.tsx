import type {
  ReaderFontFamily,
  ReaderMode,
  ReaderPreferences,
  ReaderTheme,
} from '@/domain/reader';
import './typography-panel.css';

const FONTS: readonly { value: ReaderFontFamily; label: string }[] = [
  { value: 'system-serif', label: 'System Serif' },
  { value: 'system-sans', label: 'System Sans' },
  { value: 'georgia', label: 'Georgia' },
  { value: 'iowan', label: 'Iowan' },
  { value: 'inter', label: 'Inter' },
];

const THEMES: readonly ReaderTheme[] = ['light', 'dark', 'sepia'];
const MODES: readonly ReaderMode[] = ['paginated', 'scroll'];

const LINE_HEIGHT_LABELS: readonly string[] = ['tight', 'normal', 'loose'];
const MARGIN_LABELS: readonly string[] = ['narrow', 'normal', 'wide'];

type Props = {
  readonly preferences: ReaderPreferences;
  readonly onChange: (prefs: ReaderPreferences) => void;
};

export function TypographyPanel({ preferences, onChange }: Props) {
  const t = preferences.typography;

  return (
    <section className="typography-panel" aria-label="Reader preferences">
      <label className="typography-panel__row">
        <span>Font</span>
        <select
          value={t.fontFamily}
          onChange={(e) => {
            onChange({
              ...preferences,
              typography: { ...t, fontFamily: e.target.value as ReaderFontFamily },
            });
          }}
        >
          {FONTS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </label>

      <div className="typography-panel__row">
        <span>Size</span>
        <button
          type="button"
          aria-label="Decrease font size"
          disabled={t.fontSizeStep === 0}
          onClick={() => {
            onChange({
              ...preferences,
              typography: {
                ...t,
                fontSizeStep: Math.max(0, t.fontSizeStep - 1) as typeof t.fontSizeStep,
              },
            });
          }}
        >
          −
        </button>
        <span aria-live="polite">{String(t.fontSizeStep + 1)} / 5</span>
        <button
          type="button"
          aria-label="Increase font size"
          disabled={t.fontSizeStep === 4}
          onClick={() => {
            onChange({
              ...preferences,
              typography: {
                ...t,
                fontSizeStep: Math.min(4, t.fontSizeStep + 1) as typeof t.fontSizeStep,
              },
            });
          }}
        >
          +
        </button>
      </div>

      <div className="typography-panel__row" role="group" aria-label="Line height">
        <span>Line height</span>
        {LINE_HEIGHT_LABELS.map((label, i) => (
          <button
            key={label}
            type="button"
            aria-pressed={t.lineHeightStep === i}
            onClick={() => {
              onChange({
                ...preferences,
                typography: { ...t, lineHeightStep: i as 0 | 1 | 2 },
              });
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="typography-panel__row" role="group" aria-label="Margins">
        <span>Margins</span>
        {MARGIN_LABELS.map((label, i) => (
          <button
            key={label}
            type="button"
            aria-pressed={t.marginStep === i}
            onClick={() => {
              onChange({
                ...preferences,
                typography: { ...t, marginStep: i as 0 | 1 | 2 },
              });
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <fieldset className="typography-panel__row">
        <legend>Theme</legend>
        {THEMES.map((theme) => (
          <label key={theme}>
            <input
              type="radio"
              name="reader-theme"
              checked={preferences.theme === theme}
              onChange={() => {
                onChange({ ...preferences, theme });
              }}
            />
            <span style={{ textTransform: 'capitalize' }}>{theme}</span>
          </label>
        ))}
      </fieldset>

      <fieldset className="typography-panel__row">
        <legend>Reading mode</legend>
        {MODES.map((mode) => (
          <label key={mode}>
            <input
              type="radio"
              name="reader-mode"
              checked={preferences.modeByFormat.epub === mode}
              onChange={() => {
                onChange({ ...preferences, modeByFormat: { epub: mode } });
              }}
            />
            <span style={{ textTransform: 'capitalize' }}>{mode}</span>
          </label>
        ))}
      </fieldset>
    </section>
  );
}
