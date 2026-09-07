/**
 * App chrome state: color theme and which nav overlay is open.
 * Theme is a UI preference, not user data, so localStorage is the right home
 * (see Docs/DECISIONS.md) — dark is the default, matching the landing's void.
 */
import { computed, ref, watch } from 'vue'
import { normalizeQuizSetup, type QuizSetup } from '@/lib/quiz'
import { DEFAULT_HIGHLIGHT_HEX, HIGHLIGHT_COLORS } from '@/lib/highlight'
import { defineStore } from 'pinia'

const THEME_KEY = 'bookworm.theme.v1'
const PAGE_THEME_KEY = 'bookworm.pageTheme.v1'
const FONT_SIZE_KEY = 'bookworm.fontSize.v1'
const FONT_FAMILY_KEY = 'bookworm.fontFamily.v1'
const SPREAD_KEY = 'bookworm.spread.v1'
const FLOW_KEY = 'bookworm.flow.v1'
const CHAT_DOCK_KEY = 'bookworm.chatDock.v1'
const CHAT_SIZE_KEY = 'bookworm.chatSize.v1'
const QUIZ_SETUP_KEY = 'bookworm.quizSetup.v1'
const INK_KEY = 'bookworm.ink.v1'

export type Theme = 'dark' | 'light'
export type Overlay = 'settings' | 'lang' | 'support' | 'shelf' | null
export type ReaderFont = 'book' | 'serif' | 'sans'
/** How many pages of a book are shown side by side. */
export type ReaderSpread = 'single' | 'double'
/**
 * How the text is served up: in pages you turn, or as one continuous strip you
 * scroll. Pages are the better read on a screen wide enough to hold them;
 * scrolling is what a phone is for, and it is the gesture a thumb already
 * knows. Kept apart from the spread because they answer different questions —
 * how MANY pages, versus whether there are pages at all.
 */
export type ReaderFlow = 'paged' | 'scroll'
/**
 * Where the assistant lives. 'drawer' lays it across the bottom of the reader
 * so the book stays visible above it; 'side' detaches it into a right-hand
 * column, trading horizontal space for the book's full height — which is the
 * better trade on a wide screen, and the worse one on a laptop.
 */
export type ChatDock = 'drawer' | 'side'

/** Share of the reader the assistant takes, as a percentage of the axis it
 *  grows along (drawer: height; side: width). Clamped so neither the book nor
 *  the conversation can be squeezed out of existence. */
export const CHAT_SIZE_MIN = 20
export const CHAT_SIZE_MAX = 70
export const CHAT_SIZE_DEFAULT = 44

export const FONT_SIZE_MIN = 70
export const FONT_SIZE_MAX = 180
export const FONT_SIZE_STEP = 10

function readStoredTheme(key: string, fallback: Theme): Theme {
  try {
    const raw = localStorage.getItem(key)
    if (raw === 'light' || raw === 'dark') return raw
  } catch {
    // Unavailable storage: fall through to the default.
  }
  return fallback
}

export const useUiStore = defineStore('ui', () => {
  const theme = ref<Theme>(readStoredTheme(THEME_KEY, 'dark'))
  /** Theme of the book page itself inside the reader — independent of the app
   *  chrome, because paper-white text pages under a dark chrome (and the
   *  reverse) are both legitimate reading moods. Defaults to paper. */
  const pageTheme = ref<Theme>(readStoredTheme(PAGE_THEME_KEY, 'light'))
  const overlay = ref<Overlay>(null)

  function applyTheme(): void {
    document.documentElement.dataset.theme = theme.value
  }

  watch(
    theme,
    () => {
      applyTheme()
      try {
        localStorage.setItem(THEME_KEY, theme.value)
      } catch {
        // Storage unavailable: the choice simply won't persist.
      }
    },
    { immediate: true },
  )

  function toggleTheme(): void {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
  }

  /**
   * Focus mode: the book takes the whole window and ALL chrome (nav,
   * toolbar, controls) hides. One state, one exit: tapping the book's
   * center, Esc, or the focus button all leave it entirely — chrome and
   * normal layout return together.
   */
  const focusMode = ref(false)
  const chromeVisible = computed(() => !focusMode.value)

  function enterFocus(): void {
    focusMode.value = true
  }

  function exitFocus(): void {
    focusMode.value = false
  }

  function togglePageTheme(): void {
    pageTheme.value = pageTheme.value === 'dark' ? 'light' : 'dark'
    try {
      localStorage.setItem(PAGE_THEME_KEY, pageTheme.value)
    } catch {
      // Storage unavailable: the choice simply won't persist.
    }
  }

  /** Reader typography (EPUB only — PDFs are baked pages), reader-wide. */
  const fontSize = ref<number>(
    (() => {
      try {
        const raw = Number(localStorage.getItem(FONT_SIZE_KEY))
        if (Number.isFinite(raw) && raw >= FONT_SIZE_MIN && raw <= FONT_SIZE_MAX) return raw
      } catch {
        // Fall through.
      }
      return 100
    })(),
  )
  const fontFamily = ref<ReaderFont>(
    (() => {
      try {
        const raw = localStorage.getItem(FONT_FAMILY_KEY)
        if (raw === 'book' || raw === 'serif' || raw === 'sans') return raw
      } catch {
        // Fall through.
      }
      return 'book'
    })(),
  )

  /**
   * One page or two. 'double' is epub.js's `auto`, which still falls back to a
   * single column when the pane is too narrow for two — so this is a ceiling,
   * not a demand, and a phone reads sensibly either way.
   */
  const spread = ref<ReaderSpread>(
    (() => {
      try {
        const raw = localStorage.getItem(SPREAD_KEY)
        if (raw === 'single' || raw === 'double') return raw
      } catch {
        // Fall through.
      }
      return 'double'
    })(),
  )

  const flow = ref<ReaderFlow>(
    (() => {
      try {
        const raw = localStorage.getItem(FLOW_KEY)
        if (raw === 'paged' || raw === 'scroll') return raw
      } catch {
        // Fall through.
      }
      return 'paged'
    })(),
  )

  function toggleFlow(): void {
    flow.value = flow.value === 'scroll' ? 'paged' : 'scroll'
    try {
      localStorage.setItem(FLOW_KEY, flow.value)
    } catch {
      // The preference just won't persist.
    }
  }

  /** Whether the assistant has a share of the stage. It lives here rather than
   *  inside the panel because the READER has to know: the book's pane changes
   *  size when it opens, and a reflowable book must be told, not left to an
   *  observer to discover a beat later (Docs/LESSONS.md). */
  const chatOpen = ref(false)

  function setChatOpen(value: boolean): void {
    chatOpen.value = value
  }

  const chatDock = ref<ChatDock>(
    (() => {
      try {
        const raw = localStorage.getItem(CHAT_DOCK_KEY)
        if (raw === 'drawer' || raw === 'side') return raw
      } catch {
        // Fall through.
      }
      return 'drawer'
    })(),
  )

  /** Kept per dock: the right height for a drawer is not the right width for
   *  a column, and switching should not scramble the other one's size. */
  const chatSize = ref<Record<ChatDock, number>>(
    (() => {
      const fallback: Record<ChatDock, number> = {
        drawer: CHAT_SIZE_DEFAULT,
        side: CHAT_SIZE_DEFAULT,
      }
      try {
        const raw = JSON.parse(localStorage.getItem(CHAT_SIZE_KEY) ?? 'null') as unknown
        if (raw && typeof raw === 'object') {
          const stored = raw as Partial<Record<ChatDock, unknown>>
          for (const dock of ['drawer', 'side'] as const) {
            const value = Number(stored[dock])
            if (Number.isFinite(value)) {
              fallback[dock] = Math.min(Math.max(value, CHAT_SIZE_MIN), CHAT_SIZE_MAX)
            }
          }
        }
      } catch {
        // Fall through.
      }
      return fallback
    })(),
  )

  function persistChat(): void {
    try {
      localStorage.setItem(CHAT_DOCK_KEY, chatDock.value)
      localStorage.setItem(CHAT_SIZE_KEY, JSON.stringify(chatSize.value))
    } catch {
      // Won't persist.
    }
  }

  function toggleChatDock(): void {
    chatDock.value = chatDock.value === 'drawer' ? 'side' : 'drawer'
    persistChat()
  }

  function setChatSize(percent: number): void {
    if (!Number.isFinite(percent)) return
    chatSize.value = {
      ...chatSize.value,
      [chatDock.value]: Math.min(Math.max(percent, CHAT_SIZE_MIN), CHAT_SIZE_MAX),
    }
    persistChat()
  }

  /**
   * How the reader likes to be quizzed. Remembered because nobody wants to set
   * up the same quiz twice, and it is a preference rather than user data — so
   * localStorage, like everything else here.
   */
  const quizSetup = ref<QuizSetup>(
    (() => {
      try {
        return normalizeQuizSetup(JSON.parse(localStorage.getItem(QUIZ_SETUP_KEY) ?? 'null'))
      } catch {
        return normalizeQuizSetup(null)
      }
    })(),
  )

  function setQuizSetup(next: QuizSetup): void {
    quizSetup.value = normalizeQuizSetup(next)
    try {
      localStorage.setItem(QUIZ_SETUP_KEY, JSON.stringify(quizSetup.value))
    } catch {
      // Won't persist.
    }
  }

  /**
   * The ink the reader last marked a passage with. Remembered because a reader
   * settles on a colour and stays there — and because the toolbar's inkwell
   * shows it, the collapsed control is already the answer most of the time.
   */
  const inkHex = ref<string>(
    (() => {
      try {
        const raw = localStorage.getItem(INK_KEY)
        if (HIGHLIGHT_COLORS.some((color) => color.hex === raw)) return raw as string
      } catch {
        // Fall through.
      }
      return DEFAULT_HIGHLIGHT_HEX
    })(),
  )

  function setInk(hex: string): void {
    if (!HIGHLIGHT_COLORS.some((color) => color.hex === hex)) return
    inkHex.value = hex
    try {
      localStorage.setItem(INK_KEY, hex)
    } catch {
      // Won't persist.
    }
  }

  function toggleSpread(): void {
    spread.value = spread.value === 'double' ? 'single' : 'double'
    try {
      localStorage.setItem(SPREAD_KEY, spread.value)
    } catch {
      // Won't persist.
    }
  }

  function adjustFontSize(delta: number): void {
    fontSize.value = Math.min(Math.max(fontSize.value + delta, FONT_SIZE_MIN), FONT_SIZE_MAX)
    try {
      localStorage.setItem(FONT_SIZE_KEY, String(fontSize.value))
    } catch {
      // Won't persist.
    }
  }

  function setFontFamily(value: ReaderFont): void {
    fontFamily.value = value
    try {
      localStorage.setItem(FONT_FAMILY_KEY, value)
    } catch {
      // Won't persist.
    }
  }

  /** Opening an overlay closes any other; asking for the open one closes it. */
  function toggleOverlay(name: Exclude<Overlay, null>): void {
    overlay.value = overlay.value === name ? null : name
  }

  function closeOverlay(): void {
    overlay.value = null
  }

  return {
    theme,
    pageTheme,
    overlay,
    focusMode,
    chromeVisible,
    fontSize,
    fontFamily,
    spread,
    flow,
    toggleFlow,
    chatOpen,
    chatDock,
    chatSize,
    quizSetup,
    inkHex,
    toggleTheme,
    togglePageTheme,
    adjustFontSize,
    setFontFamily,
    toggleSpread,
    toggleChatDock,
    setChatSize,
    setQuizSetup,
    setInk,
    setChatOpen,
    enterFocus,
    exitFocus,
    toggleOverlay,
    closeOverlay,
  }
})
