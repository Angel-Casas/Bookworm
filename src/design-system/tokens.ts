// Design tokens — the typed source of truth.
// Keep `tokens.css` in sync with this file: every token here has a matching
// CSS custom property consumed by component styles. Diverging the two means
// runtime values won't match what TS reports.

export const colorsLight = {
  bg: '#f6f1e8',
  surface: '#fbf6ec',
  panel: '#efe9dd',
  text: '#1a1714',
  textMuted: '#5a4f44',
  textSubtle: '#8a7d6d',
  border: '#d8cdb8',
  borderSubtle: '#e6dec8',
  accent: '#b08a4b',
  accentMuted: '#c9a974',
  success: '#5a7a4a',
  warning: '#b07e2b',
  danger: '#a13e2c',
  highlightYellow: '#f5e187',
  highlightGreen: '#c8dba4',
  highlightBlue: '#aac8e3',
  highlightPink: '#e9c2cc',
  shadow: 'rgba(50, 40, 30, 0.10)',
} as const;

export const colorsDark = {
  bg: '#1a1714',
  surface: '#22201d',
  panel: '#2a2622',
  text: '#ece4d3',
  textMuted: '#a39988',
  textSubtle: '#76705f',
  border: '#3a342d',
  borderSubtle: '#2f2a25',
  accent: '#caa362',
  accentMuted: '#a08552',
  success: '#7e9c6e',
  warning: '#d4a45a',
  danger: '#c66a55',
  highlightYellow: '#a89149',
  highlightGreen: '#7e9163',
  highlightBlue: '#6b87a3',
  highlightPink: '#a07380',
  shadow: 'rgba(0, 0, 0, 0.45)',
} as const;

export const fonts = {
  serif: "'Iowan Old Style', 'Charter', 'Source Serif Pro', 'Cambria', 'Georgia', serif",
  sans: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "'JetBrains Mono', 'SF Mono', 'Fira Code', ui-monospace, monospace",
} as const;

export const fontSize = {
  xs: '0.75rem',
  sm: '0.875rem',
  base: '1rem',
  md: '1.125rem',
  lg: '1.25rem',
  xl: '1.5rem',
  '2xl': '2rem',
  '3xl': '2.5rem',
  '4xl': '3.5rem',
} as const;

export const lineHeight = {
  tight: '1.15',
  base: '1.55',
  reading: '1.7',
} as const;

export const space = {
  0: '0',
  1: '0.125rem',
  2: '0.25rem',
  3: '0.375rem',
  4: '0.5rem',
  5: '0.75rem',
  6: '1rem',
  7: '1.25rem',
  8: '1.5rem',
  10: '2rem',
  12: '2.5rem',
  14: '3rem',
  16: '4rem',
  20: '5rem',
} as const;

export const radius = {
  none: '0',
  xs: '0.25rem',
  sm: '0.375rem',
  base: '0.5rem',
  md: '0.75rem',
  lg: '1rem',
  xl: '1.5rem',
  full: '9999px',
} as const;

export const duration = {
  fast: '120ms',
  base: '200ms',
  slow: '320ms',
  slower: '480ms',
} as const;

export const easing = {
  out: 'cubic-bezier(0.22, 1, 0.36, 1)',
  inOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
} as const;

export const layer = {
  base: 0,
  raised: 10,
  panel: 20,
  overlay: 100,
  modal: 200,
  toast: 300,
} as const;

export type ColorScale = typeof colorsLight;
export type ThemeMode = 'light' | 'dark';

export const tokens = {
  colors: { light: colorsLight, dark: colorsDark },
  fonts,
  fontSize,
  lineHeight,
  space,
  radius,
  duration,
  easing,
  layer,
} as const;

export type Tokens = typeof tokens;
