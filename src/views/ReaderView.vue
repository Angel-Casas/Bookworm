<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { cfiWithinRange } from '@/lib/annotationSort'
import { formatPageCount, readingProgress, type PageCount } from '@/lib/pagination'
import { formatUsd } from '@/lib/cost'
import { useLanguageStore } from '@/stores/language'
import { shiftIntoView } from '@/lib/popover'
import { getBookFile, getBookMeta } from '@/services/db'
import { debounce } from '@/services/debounce'
import { useLibraryStore } from '@/stores/library'
import { useSpendStore } from '@/stores/spend'
import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  FONT_SIZE_STEP,
  useUiStore,
  type ReaderFont,
} from '@/stores/ui'
import EpubReader from '@/components/reader/EpubReader.vue'
import PdfReader from '@/components/reader/PdfReader.vue'
import AnnotationsPanel from '@/components/reader/AnnotationsPanel.vue'
import WordLookup from '@/components/reader/WordLookup.vue'
import PageDogEar from '@/components/reader/PageDogEar.vue'
import SearchPanel from '@/components/reader/SearchPanel.vue'
import ChatOverlay from '@/components/chat/ChatOverlay.vue'
import IconLamp from '@/components/icons/IconLamp.vue'
import IconClose from '@/components/icons/IconClose.vue'
import IconFocus from '@/components/icons/IconFocus.vue'
import IconInkwell from '@/components/icons/IconInkwell.vue'
import IconDaylight from '@/components/icons/IconDaylight.vue'
import IconSpread from '@/components/icons/IconSpread.vue'
import IconType from '@/components/icons/IconType.vue'
import IconRibbon from '@/components/icons/IconRibbon.vue'
import IconSearch from '@/components/icons/IconSearch.vue'
import IconGloss from '@/components/icons/IconGloss.vue'
import { lookupTerm } from '@/lib/lookup'
import { buildMarksMarkdown, marksFilename } from '@/lib/marksExport'
import { useI18n, type MessageKey } from '@/i18n'
import { marksWordsIn } from '@/i18n/bundles'
import { useLookupStore } from '@/stores/lookup'
import { useAnnotationsStore } from '@/stores/annotations'
import { useStatsStore } from '@/stores/stats'
import { HIGHLIGHT_COLORS } from '@/lib/highlight'
import type { Annotation, BookMeta } from '@/lib/types'

const props = defineProps<{ id: string }>()

/**
 * A book can be opened AT something: the shelf-wide search sends `at` (a place
 * in the book) and, for a passage, `q` (the words it found there). The place
 * becomes the book's opening position, and the words are used once the book is
 * on screen to land on the match itself rather than at the top of its chapter.
 */
const route = useRoute()
const openAt = computed(() => (typeof route.query.at === 'string' ? route.query.at : null))
const openFor = computed(() => (typeof route.query.q === 'string' ? route.query.q : null))
let arrivalPending = false

const library = useLibraryStore()
const language = useLanguageStore()
const spend = useSpendStore()
const ui = useUiStore()
const annotations = useAnnotationsStore()
const statsStore = useStatsStore()
const lookup = useLookupStore()
const { t } = useI18n()
const book = ref<BookMeta | null>(null)
const blob = ref<Blob | null>(null)
const notFound = ref(false)
const lastSelection = ref<string | null>(null)
const selectionPosition = ref<string | null>(null)
/** The block of prose the selection was taken from — what a single word needs
 *  to be looked up in the sentence it belongs to. */
const selectionContext = ref('')
const currentPosition = ref<string | null>(null)
const currentSectionIndex = ref(0)
/**
 * Bookmarks and Search share one slot at the top-right of the reader, so they
 * are ONE piece of state rather than two booleans to keep in step: opening
 * either closes the other, and nothing can stack them into an unreadable pile.
 */
type SidePanel = 'annotations' | 'search' | 'lookup'
const sidePanel = ref<SidePanel | null>(null)

function toggleSidePanel(which: SidePanel): void {
  // The slot holds one panel; a gloss displaced by Bookmarks or Search is
  // over, and its request with it.
  if (sidePanel.value === 'lookup' && which !== 'lookup') lookup.close()
  sidePanel.value = sidePanel.value === which ? null : which
}
const typeMenuOpen = ref(false)
const typeWrap = ref<HTMLDivElement | null>(null)
const typeMenu = ref<HTMLDivElement | null>(null)
/** How far the type menu has to slide to stay on screen. It hangs from its own
 *  button — a menu that opens somewhere else has to be hunted for — and moves
 *  only as far as the edge forces it. */
const typeShift = ref(0)

function toggleTypeMenu(): void {
  typeMenuOpen.value = !typeMenuOpen.value
  if (!typeMenuOpen.value) return
  typeShift.value = 0
  void nextTick(() => {
    const box = typeMenu.value?.getBoundingClientRect()
    if (box) typeShift.value = shiftIntoView(box, window.innerWidth)
  })
}

const READER_FONTS: readonly { id: ReaderFont; labelKey: MessageKey }[] = [
  { id: 'book', labelKey: 'reader.fontBook' },
  { id: 'serif', labelKey: 'reader.fontSerif' },
  { id: 'sans', labelKey: 'reader.fontSans' },
] as const
const readerRef = ref<{
  goToPosition: (position: string) => void
  goToMatch: (position: string, term: string) => Promise<void>
  next: () => void
  previous: () => void
  refit: () => void
} | null>(null)
const chatRef = ref<{ openPanel: () => void } | null>(null)

/**
 * Where the reader is, written to the shelf's copy of the book.
 *
 * Position and progress are saved TOGETHER, from whichever of the two changed,
 * because they arrive at different moments: the position on every relocation,
 * the progress only once the book's pages have been counted (which can be
 * seconds later, or never for a book still paginating). Progress is only ever
 * replaced by a known one — an unknown count must not erase the percentage the
 * shelf is already showing.
 */
const saveProgress = debounce(() => {
  if (!book.value) return
  const position = currentPosition.value ?? book.value.position ?? null
  const progress = readingProgress(pageCount.value) ?? book.value.progress ?? null
  if (position === book.value.position && progress === book.value.progress) return
  // Through the store, not straight to the database: the shelf holds the same
  // record and the two must not save over each other (see patchBook).
  void library.saveReadingState(props.id, position, progress).then((updated) => {
    if (updated) book.value = updated
  })
}, 500)

// Reading-session tracking. Deltas are flushed periodically, on unmount and on
// pagehide: a write started during page unload can be dropped by the browser,
// so the periodic flush keeps losses to at most one interval.
const STATS_FLUSH_INTERVAL_MS = 30_000
let lastFlushAt = Date.now()
let sessionTurns = 0
let firstPositionSeen = false

function flushSession(): void {
  const now = Date.now()
  const seconds = Math.round((now - lastFlushAt) / 1000)
  const turns = sessionTurns
  lastFlushAt = now
  sessionTurns = 0
  if (seconds > 0 || turns > 0) void statsStore.addSession(props.id, seconds, turns)
}

const statsInterval = setInterval(flushSession, STATS_FLUSH_INTERVAL_MS)

function onPageHide(): void {
  flushSession()
}

function onPositionChange(position: string): void {
  // A relocation is not always a MOVE: epub.js re-reports the same position
  // whenever the pane re-flows — a settle after load, a resize, the assistant
  // taking its share. Those are not pages read, and counting them inflated the
  // reading stats every time the window changed shape.
  const moved = position !== currentPosition.value
  // The first emission is the initial render/restore, not a page turn either.
  if (!firstPositionSeen) {
    firstPositionSeen = true
    // The book is on screen: now the words can be found on the page. Any
    // earlier and there is nothing laid out to search.
    if (arrivalPending) {
      arrivalPending = false
      const term = openFor.value
      const at = openAt.value
      if (term && at) void readerRef.value?.goToMatch(at, term)
    }
  } else if (moved) sessionTurns += 1
  currentPosition.value = position
  saveProgress()
  // The highlight editor is anchored to pixels, so it goes on ANY relocation —
  // a re-flow slides the words out from under it just as surely as a page turn.
  editingHl.value = null
  // The ink is anchored to the TOOLBAR, which does not move, so it only closes
  // when the reader has actually gone somewhere else.
  if (moved) dropInk()
}

/**
 * Marking a passage lives in the TOOLBAR, not over the words.
 *
 * A palette floating at the selection is where the phone's own selection bar
 * (copy · translate · share) lands, and that bar is browser chrome — no
 * z-index reaches it. So the ink sits in the same place every time: one well,
 * in the colour last used, which opens into the full palette when there is
 * something to mark or when the reader asks for it.
 */
const inkOpen = ref(false)
/** A selection waiting to be marked. Not `lastSelection`, which outlives it:
 *  the assistant keeps the passage as a chip long after the ink is put away. */
const inkPending = ref(false)
let inkOpenedAt = 0

const inkShowing = computed(() => inkOpen.value || inkPending.value)

/**
 * Focus mode tucks the toolbar away — but the ink lives there now, so marking
 * a passage has to bring it back. It returns laid OVER the page rather than
 * back into the layout: a strip of chrome that re-flows the book would move
 * the very words the reader just chose.
 */
const headerPeek = computed(() => !ui.chromeVisible && inkShowing.value)
const headerVisible = computed(() => ui.chromeVisible || headerPeek.value)

function anchorPoint(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.min(Math.max(x, 130), window.innerWidth - 130),
    y: Math.max(y, 140),
  }
}

function onSelection(text: string, position: string, context = ''): void {
  lastSelection.value = text
  selectionPosition.value = position
  selectionContext.value = context
  inkOpenedAt = Date.now()
  inkPending.value = true
  editingHl.value = null
}

/**
 * A word worth glossing, or null. The offer lives as long as the ink does —
 * both are things to do with the passage you have just chosen — so it goes
 * away when the reader taps the page, not when the card is closed.
 */
const lookupWord = computed(() => (inkPending.value ? lookupTerm(lastSelection.value ?? '') : null))

/**
 * Ask what a word means. Nothing is spent until this is pressed: a selection
 * is not a question, and a reader who highlights a hundred passages should not
 * be billed for a hundred glosses they never asked for.
 */
function askMeaning(): void {
  const word = lookupWord.value
  if (!word || !book.value) return
  sidePanel.value = 'lookup'
  dropInk()
  void lookup.look(
    book.value.id,
    { title: book.value.title, author: book.value.author },
    word,
    selectionContext.value || (lastSelection.value ?? ''),
    book.value.modelId ?? null,
  )
}

function closeLookup(): void {
  lookup.close()
  if (sidePanel.value === 'lookup') sidePanel.value = null
}

/**
 * A fair copy of this book's marks, as a markdown file.
 *
 * The shaping is pure (src/lib/marksExport.ts); what is left here is the
 * browser's only way to hand a file to somebody — an anchor, clicked.
 */
function saveMarks(): void {
  if (!book.value) return
  const markdown = buildMarksMarkdown(
    { title: book.value.title, author: book.value.author, format: book.value.format },
    annotations.annotationsFor(book.value.id),
    Date.now(),
    language.code,
    marksWordsIn(language.code),
  )
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = marksFilename(book.value.title)
  anchor.click()
  URL.revokeObjectURL(url)
}

/** From a gloss into a conversation, carrying the sentence with it. */
function onLookupAsk(text: string): void {
  lastSelection.value = text
  closeLookup()
  chatRef.value?.openPanel()
}

function dropInk(): void {
  inkPending.value = false
  inkOpen.value = false
}

/**
 * A plain tap/click on the book page. Priority: dismiss any open popover;
 * otherwise the side zones turn pages and the center governs focus chrome.
 */
function onPageTap(fraction: number): void {
  if (Date.now() - inkOpenedAt < 250 || Date.now() - editorOpenedAt < 250) return
  if (inkShowing.value || editingHl.value) {
    dropInk()
    editingHl.value = null
    return
  }
  if ((window.getSelection()?.toString() ?? '').trim().length > 0) return
  if (fraction < 0.28) readerRef.value?.previous()
  else if (fraction > 0.72) readerRef.value?.next()
  else if (ui.focusMode) ui.exitFocus()
}

function onSwipe(direction: 'left' | 'right'): void {
  if (inkShowing.value || editingHl.value) return
  if (direction === 'left') readerRef.value?.next()
  else readerRef.value?.previous()
}

/**
 * Focus mode fills the browser WINDOW with the book and tucks the chrome
 * away — deliberately not the Fullscreen API, which would take over the
 * whole display rather than just the site.
 */
function toggleFocus(): void {
  if (ui.focusMode) ui.exitFocus()
  else {
    // Focus mode is the book and nothing else — a panel left floating over it
    // would be the loudest thing on a screen meant to be quiet.
    sidePanel.value = null
    ui.setChatOpen(false)
    ui.enterFocus()
  }
}

/**
 * The glitch on focus toggles was LATENCY: the pane snapped to its new size
 * while the reader's re-layout sat behind a debounce, so a stale-width page
 * was visible for a beat (and veiling it just traded the glitch for a
 * flash). Instead, refit the reader synchronously in the same tick as the
 * layout change — Vue patches the DOM, we immediately hand the reader its
 * true new size, and both land in the same paint. No intermediate state,
 * nothing to hide.
 */
watch(
  () => ui.focusMode,
  async () => {
    await nextTick()
    readerRef.value?.refit()
  },
)

/**
 * The assistant takes its share out of the BOOK's pane, so every change to it
 * — opening, detaching, dragging the shared edge — is a resize the reader has
 * to be told about in the same tick, for exactly the reason focus mode was.
 */
async function refitReader(): Promise<void> {
  await nextTick()
  readerRef.value?.refit()
}

watch(() => [ui.chatOpen, ui.chatDock, ui.chatSize[ui.chatDock]], refitReader)

function positionLabel(): string {
  if (!book.value) return ''
  return book.value.format === 'pdf'
    ? t('reader.pageLabel', { n: currentPosition.value ?? '1' })
    : t('reader.sectionLabel', { n: currentSectionIndex.value + 1 })
}

/** Where the reader is, in words — the assistant says it in its header so a
 *  spoiler-safe answer is visibly anchored to a place. */
const placeLabel = computed(() => {
  if (!book.value) return ''
  const count = pageCount.value
  if (count && count.total > 0)
    return t('reader.pageOf', { current: count.current, total: count.total })
  return positionLabel()
})

function effectivePosition(): string | null {
  return currentPosition.value ?? book.value?.position ?? null
}

/**
 * Where the reader is, in pages. PDFs report real pages; EPUBs report the
 * synthetic ones their pagination invents, and stay silent (total 0) until
 * that pagination has been built.
 */
/**
 * Whether the page is narrower than the stage it sits in. Only EPUBs narrow —
 * a PDF page is a fixed sheet the pane already fits — and only on one page at
 * a time, where a full-width column would run past a readable measure.
 */
const pageNarrowed = computed(() => book.value?.format === 'epub' && ui.spread === 'single')

/**
 * Phone-shaped, at the same width where the assistant changes what its docks
 * mean (see ChatOverlay). Watched rather than measured once: a tablet turns,
 * and a window on a desktop gets dragged narrow.
 */
const PHONE_QUERY = '(max-width: 46rem)'
const onPhone = ref(false)
let phoneMedia: MediaQueryList | null = null
function onPhoneChange(event: MediaQueryListEvent): void {
  onPhone.value = event.matches
}

/**
 * On a phone the side dock is the WHOLE screen, so the book behind it is not
 * merely covered — it is out of reach. Saying so keeps stray taps off the
 * pager and keeps a screen reader inside the conversation.
 */
const chatOwnsScreen = computed(() => onPhone.value && ui.chatOpen && ui.chatDock === 'side')

/**
 * What the layout button offers next. On a wide screen it is the old question
 * — one page or two. On a phone two pages were never possible, which is why
 * the button looked broken there; it asks instead whether the book comes in
 * pages at all, or as one strip to scroll.
 */
const layoutLabel = computed(() => {
  if (onPhone.value)
    return ui.flow === 'scroll' ? t('reader.readInPages') : t('reader.scrollWholeBook')
  return ui.spread === 'double' ? t('reader.singlePage') : t('reader.twoPage')
})
/** The face the button wears: what you are reading NOW. */
const layoutIcon = computed<'single' | 'double' | 'scroll'>(() => {
  if (onPhone.value) return ui.flow === 'scroll' ? 'scroll' : 'single'
  return ui.spread === 'double' ? 'double' : 'single'
})

const pageCount = ref<PageCount | null>(null)
const pageCountLabel = computed(() => formatPageCount(pageCount.value))

function onPageMetrics(current: number, total: number): void {
  pageCount.value = { current, total }
  // The count often lands after the position it belongs to, so the progress is
  // saved from here as well as from the relocation.
  saveProgress()
}

/** CFI span currently on screen (EPUB only), refreshed on every relocation. */
const visibleRange = ref<{ start: string; end: string } | null>(null)

function onRangeChange(start: string, end: string): void {
  visibleRange.value = { start, end }
}

/**
 * The bookmark belonging to the page in front of the reader.
 *
 * EPUBs re-paginate whenever the pane changes — focus mode, type size, a
 * window resize — so a stored CFI stops being any page's start and exact
 * matching loses the mark for good. Ask instead whether the mark falls
 * within the visible span. PDF pages are fixed, so a page number is exact.
 */
const currentBookmark = computed(() => {
  const current = book.value
  if (!current) return null
  const bookmarks = annotations
    .annotationsFor(current.id)
    .filter((item) => item.type === 'bookmark')
  if (bookmarks.length === 0) return null

  const range = visibleRange.value
  if (current.format === 'epub' && range) {
    return bookmarks.find((item) => cfiWithinRange(item.position, range.start, range.end)) ?? null
  }
  const position = currentPosition.value ?? current.position ?? null
  return position === null ? null : (bookmarks.find((item) => item.position === position) ?? null)
})

/**
 * Why the fold is going away. Un-drawing the mark is the answer to the reader
 * removing the bookmark; when the page simply turns past it, or the text
 * re-flows so the mark now sits elsewhere, the fold belongs to the page that
 * left and goes with it. Sync flush so this is settled before the fold sees
 * `marked` drop — the store records the deleted id just before the list
 * changes, which is what makes the two cases distinguishable at all.
 */
const foldExit = ref<'draw' | 'cut'>('cut')

watch(
  () => currentBookmark.value?.id ?? null,
  (now, was) => {
    if (was !== null && now === null) {
      foldExit.value = annotations.lastRemovedId === was ? 'draw' : 'cut'
    }
  },
  { flush: 'sync' },
)

/**
 * The lamp is switched by yanking its pull chain: the click starts the cord
 * animation, the light flips at the bottom of the tug, and further pulls are
 * ignored until the cord settles (a chain mid-yank can't be pulled again).
 */
const pulling = ref(false)
const PULL_FLIP_MS = 190
const PULL_SETTLE_MS = 560

function pullLamp(): void {
  if (pulling.value) return
  pulling.value = true
  window.setTimeout(() => {
    void toggleBookmark()
  }, PULL_FLIP_MS)
  window.setTimeout(() => {
    pulling.value = false
  }, PULL_SETTLE_MS)
}

/** Toggle: bookmarking an already-bookmarked spot removes that bookmark. */
async function toggleBookmark(): Promise<void> {
  if (!book.value) return
  const position = effectivePosition()
  if (position === null) return
  const existing = currentBookmark.value
  if (existing) {
    await annotations.remove(book.value.id, existing.id)
  } else {
    await annotations.add(book.value.id, 'bookmark', position, positionLabel(), null)
  }
}

async function saveHighlight(colorHex: string): Promise<void> {
  if (!book.value || !lastSelection.value) return
  const position = selectionPosition.value ?? currentPosition.value
  if (position === null) return
  const text = lastSelection.value
  const label = text.length > 48 ? `${text.slice(0, 48)}…` : text
  await annotations.add(book.value.id, 'highlight', position, label, text, colorHex)
  dropInk()
  // Drop the native (blue) selection so the pastel wash is visible at once.
  window.getSelection()?.removeAllRanges()
}

/**
 * A swatch does one or two things: it always becomes the ink the well shows
 * from now on, and when a passage is waiting it marks that passage too.
 */
function useInk(colorHex: string): void {
  ui.setInk(colorHex)
  if (inkPending.value) void saveHighlight(colorHex)
  else inkOpen.value = false
}

const bookHighlights = computed<readonly Annotation[]>(() =>
  book.value
    ? annotations.annotationsFor(book.value.id).filter((item) => item.type === 'highlight')
    : [],
)

/** In-book highlight editor: click a wash to recolor or remove it. */
const editingHl = ref<{ id: string; x: number; y: number } | null>(null)
let editorOpenedAt = 0

const editingColor = computed(() =>
  editingHl.value
    ? (bookHighlights.value.find((item) => item.id === editingHl.value?.id)?.color ?? null)
    : null,
)

function onHighlightClick(id: string, x: number, y: number): void {
  editorOpenedAt = Date.now()
  editingHl.value = { id, ...anchorPoint(x, y) }
  dropInk()
}

async function recolorEditingHl(colorHex: string): Promise<void> {
  if (!book.value || !editingHl.value) return
  await annotations.recolor(book.value.id, editingHl.value.id, colorHex)
  editingHl.value = null
}

async function removeEditingHl(): Promise<void> {
  if (!book.value || !editingHl.value) return
  await annotations.remove(book.value.id, editingHl.value.id)
  editingHl.value = null
}

function onDocumentClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null
  if (typeMenuOpen.value && !typeWrap.value?.contains(event.target as Node)) {
    typeMenuOpen.value = false
  }
  // The click/mouseup that OPENED a popover also reaches the document; don't
  // let it close what it just opened.
  if (editingHl.value && Date.now() - editorOpenedAt >= 200 && !target?.closest('.hl-editor')) {
    editingHl.value = null
  }
  if (inkShowing.value && Date.now() - inkOpenedAt >= 250 && !target?.closest('.ink-wrap')) {
    dropInk()
  }
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  // Esc peels back one layer at a time: popovers first, then focus mode.
  if (typeMenuOpen.value) {
    typeMenuOpen.value = false
  } else if (editingHl.value || inkShowing.value) {
    editingHl.value = null
    dropInk()
  } else if (sidePanel.value === 'lookup') {
    closeLookup()
  } else if (ui.focusMode) {
    ui.exitFocus()
  }
}

function onJumpTo(position: string): void {
  readerRef.value?.goToPosition(position)
}

function onAskAbout(text: string, position: string): void {
  // Bring the book to the passage first, so the reader has it in front of
  // them while they phrase the question.
  readerRef.value?.goToPosition(position)
  lastSelection.value = text
  sidePanel.value = null
  chatRef.value?.openPanel()
}

function onSearchJump(position: string, term: string): void {
  void readerRef.value?.goToMatch(position, term)
}

async function onModelChange(modelId: string | null): Promise<void> {
  if (!book.value) return
  const updated = await library.patchBook(props.id, { modelId })
  if (updated) book.value = updated
}

function onSectionChange(index: number): void {
  currentSectionIndex.value = index
}

onMounted(() => {
  phoneMedia = window.matchMedia(PHONE_QUERY)
  onPhone.value = phoneMedia.matches
  phoneMedia.addEventListener('change', onPhoneChange)
})

onMounted(async () => {
  void spend.load()
  void annotations.load(props.id)
  arrivalPending = openAt.value !== null && openFor.value !== null
  const [meta, file] = await Promise.all([getBookMeta(props.id), getBookFile(props.id)])
  if (!meta || !file) {
    notFound.value = true
    return
  }
  book.value = meta
  blob.value = file
  // markOpened returns the stamped record; taking it back keeps this view's
  // copy current so the next save does not write the old stamp over it.
  const opened = await library.markOpened(props.id)
  if (opened) book.value = opened
})

window.addEventListener('pagehide', onPageHide)
document.addEventListener('click', onDocumentClick)
document.addEventListener('keydown', onDocumentKeydown)
onBeforeUnmount(() => {
  window.removeEventListener('pagehide', onPageHide)
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onDocumentKeydown)
  // Leaving the reader always restores the chrome.
  ui.exitFocus()
  phoneMedia?.removeEventListener('change', onPhoneChange)
  clearInterval(statsInterval)
  saveProgress.flush()
  flushSession()
})
</script>

<template>
  <section
    class="reader"
    :class="{ focus: ui.focusMode, 'chrome-hidden': !ui.chromeVisible }"
    data-testid="reader-root"
  >
    <p v-if="notFound">
      {{ t('reader.notFound') }}
      <RouterLink to="/library">{{ t('reader.backToLibrary') }}</RouterLink>
    </p>
    <template v-else-if="book && blob">
      <!-- Controls only. The book's name, its place and its cost moved down to
           the rail over the page: three facts about the book, together, in the
           space the lamp was already using. -->
      <header
        v-show="headerVisible"
        class="reader-header"
        :class="{ peek: headerPeek }"
        :inert="chatOwnsScreen"
      >
        <!-- EPUB only: a PDF's pages are baked, one per sheet. On a phone this
             button asks the OTHER question — pages or one long strip — because
             a second page was never going to fit beside the first. -->
        <button
          v-if="book.format === 'epub'"
          type="button"
          class="page-theme-btn"
          data-testid="spread-toggle"
          :aria-pressed="onPhone ? ui.flow === 'scroll' : ui.spread === 'double'"
          :aria-label="layoutLabel"
          :title="layoutLabel"
          @click="onPhone ? ui.toggleFlow() : ui.toggleSpread()"
        >
          <span class="morph-stack" aria-hidden="true">
            <IconSpread mode="single" class="pt-icon" :class="{ off: layoutIcon !== 'single' }" />
            <IconSpread mode="double" class="pt-icon" :class="{ off: layoutIcon !== 'double' }" />
            <IconSpread mode="scroll" class="pt-icon" :class="{ off: layoutIcon !== 'scroll' }" />
          </span>
        </button>
        <div v-if="book.format === 'epub'" ref="typeWrap" class="type-wrap">
          <button
            type="button"
            class="page-theme-btn"
            data-testid="type-toggle"
            aria-haspopup="menu"
            :aria-expanded="typeMenuOpen"
            :aria-label="t('reader.type')"
            :title="t('reader.type')"
            @click="toggleTypeMenu"
          >
            <IconType class="ctl-fixed" aria-hidden="true" />
          </button>
          <Transition name="pop-fade">
            <div
              v-if="typeMenuOpen"
              ref="typeMenu"
              class="type-menu"
              role="menu"
              :aria-label="t('reader.typeSettings')"
              :style="{ transform: `translateX(${typeShift}px)` }"
            >
              <div class="type-row">
                <span class="type-label">{{ t('reader.size') }}</span>
                <button
                  type="button"
                  class="type-step"
                  data-testid="font-smaller"
                  :aria-label="t('reader.smaller')"
                  :disabled="ui.fontSize <= FONT_SIZE_MIN"
                  @click="ui.adjustFontSize(-FONT_SIZE_STEP)"
                >
                  A−
                </button>
                <span class="type-value" data-testid="font-size-label">{{ ui.fontSize }}%</span>
                <button
                  type="button"
                  class="type-step"
                  data-testid="font-larger"
                  :aria-label="t('reader.larger')"
                  :disabled="ui.fontSize >= FONT_SIZE_MAX"
                  @click="ui.adjustFontSize(FONT_SIZE_STEP)"
                >
                  A+
                </button>
              </div>
              <div class="type-row">
                <span class="type-label">{{ t('reader.font') }}</span>
                <button
                  v-for="font in READER_FONTS"
                  :key="font.id"
                  type="button"
                  class="type-font"
                  :class="{ active: ui.fontFamily === font.id }"
                  :aria-pressed="ui.fontFamily === font.id"
                  :data-testid="`font-${font.id}`"
                  @click="ui.setFontFamily(font.id)"
                >
                  {{ t(font.labelKey) }}
                </button>
              </div>
            </div>
          </Transition>
        </div>
        <button
          type="button"
          class="page-theme-btn"
          data-testid="focus-toggle"
          :aria-pressed="ui.focusMode"
          :aria-label="ui.focusMode ? t('reader.focusLeave') : t('reader.focusEnter')"
          :title="ui.focusMode ? t('reader.focusLeave') : t('reader.focusEnter')"
          @click="toggleFocus"
        >
          <IconFocus class="ctl-fixed" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="page-theme-btn"
          data-testid="page-theme-toggle"
          :aria-pressed="ui.pageTheme === 'dark'"
          :aria-label="ui.pageTheme === 'dark' ? t('reader.pageLight') : t('reader.pageDark')"
          :title="ui.pageTheme === 'dark' ? t('reader.pageLight') : t('reader.pageDark')"
          @click="ui.togglePageTheme()"
        >
          <span class="morph-stack" aria-hidden="true">
            <IconDaylight mode="light" class="pt-icon" :class="{ off: ui.pageTheme !== 'light' }" />
            <IconDaylight mode="dark" class="pt-icon" :class="{ off: ui.pageTheme !== 'dark' }" />
          </span>
        </button>
        <!-- Two things to do with a word you have just chosen, side by side:
             ask what it means, or mark it. The gloss is offered only for a
             word or a very short phrase — anything longer is a question for
             the assistant, and it is one tap away in the card itself. -->
        <Transition name="pop-fade">
          <button
            v-if="lookupWord"
            type="button"
            class="page-theme-btn"
            data-testid="lookup-word"
            :aria-label="t('reader.lookUp', { word: lookupWord })"
            :title="t('reader.lookUp', { word: lookupWord })"
            @click="askMeaning"
          >
            <IconGloss class="ctl-fixed" aria-hidden="true" />
          </button>
        </Transition>
        <!-- The ink: one well in the colour last used, which OPENS SIDEWAYS
             into the whole palette when a passage is waiting or the reader
             asks. Not a menu over the toolbar — the row has the room, and a
             control that grows in place never covers anything. -->
        <div class="ink-wrap" :class="{ open: inkShowing }">
          <button
            type="button"
            class="page-theme-btn ink-btn"
            data-testid="ink-toggle"
            :class="{ pending: inkPending }"
            :aria-expanded="inkShowing"
            :aria-label="inkPending ? t('reader.markPassage') : t('reader.ink')"
            :title="inkPending ? t('reader.markPassage') : t('reader.ink')"
            @click="inkShowing ? dropInk() : ((inkOpen = true), (inkOpenedAt = Date.now()))"
          >
            <IconInkwell class="ctl-well" :color="ui.inkHex" full aria-hidden="true" />
          </button>
          <!-- Always in the DOM so it can grow and shrink; `inert` keeps it out
               of reach — and out of the tab order — while it is folded away. -->
          <div
            class="ink-strip"
            role="group"
            :aria-label="t('reader.inkGroup')"
            data-testid="ink-menu"
            :inert="!inkShowing"
          >
            <button
              v-for="(swatch, index) in HIGHLIGHT_COLORS"
              :key="swatch.id"
              type="button"
              class="hl-dot"
              :class="{ current: ui.inkHex === swatch.hex }"
              :title="
                inkPending
                  ? t('reader.highlightWith', { colour: t(swatch.nameKey) })
                  : t('reader.inkWith', { colour: t(swatch.nameKey) })
              "
              :aria-label="
                inkPending
                  ? t('reader.highlightIn', { colour: t(swatch.nameKey).toLowerCase() })
                  : t('reader.useInk', { colour: t(swatch.nameKey).toLowerCase() })
              "
              :data-testid="index === 0 ? 'save-highlight' : undefined"
              :data-swatch="swatch.id"
              @click="useInk(swatch.hex)"
            >
              <IconInkwell class="well" :color="swatch.hex" aria-hidden="true" />
            </button>
          </div>
        </div>
        <button
          type="button"
          class="page-theme-btn"
          data-testid="toggle-annotations"
          :aria-pressed="sidePanel === 'annotations'"
          :aria-label="t('reader.marksPanel')"
          :title="t('reader.marksPanel')"
          @click="toggleSidePanel('annotations')"
        >
          <IconRibbon class="ctl-fixed" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="page-theme-btn"
          data-testid="toggle-search"
          :aria-pressed="sidePanel === 'search'"
          :aria-label="t('reader.searchBook')"
          :title="t('reader.searchBook')"
          @click="toggleSidePanel('search')"
        >
          <IconSearch class="ctl-fixed" aria-hidden="true" />
        </button>
      </header>
      <!-- Book and assistant share this box: a column when the assistant is a
           drawer, a row when it is detached to the side. -->
      <div class="reader-body" :class="`chat-${ui.chatDock}`">
        <div
          class="reader-stage"
          :class="{ 'page-narrowed': pageNarrowed }"
          :inert="chatOwnsScreen"
        >
          <EpubReader
            v-if="book.format === 'epub'"
            ref="readerRef"
            :book-id="book.id"
            :blob="blob"
            :initial-position="openAt ?? book.position ?? null"
            :highlights="bookHighlights"
            :page-theme="ui.pageTheme"
            :font-size="ui.fontSize"
            :font-family="ui.fontFamily"
            :spread="ui.spread"
            :flow="onPhone ? ui.flow : 'paged'"
            @position-change="onPositionChange"
            @selection="onSelection"
            @section-change="onSectionChange"
            @highlight-click="onHighlightClick"
            @page-tap="onPageTap"
            @swipe="onSwipe"
            @range-change="onRangeChange"
            @page-metrics="onPageMetrics"
          />
          <PdfReader
            v-else
            ref="readerRef"
            :blob="blob"
            :initial-position="openAt ?? book.position ?? null"
            :highlights="bookHighlights"
            :page-theme="ui.pageTheme"
            @position-change="onPositionChange"
            @selection="onSelection"
            @section-change="onSectionChange"
            @highlight-click="onHighlightClick"
            @page-tap="onPageTap"
            @swipe="onSwipe"
            @page-metrics="onPageMetrics"
          />
          <Transition name="chrome-fade">
            <button
              v-show="ui.chromeVisible"
              type="button"
              class="lamp-btn"
              :class="{ pulling }"
              data-testid="add-bookmark"
              :data-bookmarked="currentBookmark !== null"
              :aria-pressed="currentBookmark !== null"
              :aria-label="currentBookmark ? t('reader.bookmarkRemove') : t('reader.bookmarkAdd')"
              @click="pullLamp"
            >
              <i class="lamp-thread" aria-hidden="true"></i>
              <IconLamp class="lamp-icon" :lit="currentBookmark !== null" />
              <i class="pull-cord" aria-hidden="true">
                <i class="cord-line"></i>
                <i class="cord-bead"></i>
              </i>
              <!-- The tip names what the lamp DOES; the fold shows the state. -->
              <span class="lamp-tip">{{ t('reader.bookmark') }}</span>
            </button>
          </Transition>
          <!-- The rail the lamp hangs from carries what there is to know about
             the book: its name, where you are in it, and what it has cost.
             Quiet enough to ignore while reading, and it costs no height —
             the rail was already there to hang the lamp in. -->
          <Transition name="chrome-fade">
            <div v-show="ui.chromeVisible" class="page-rail">
              <span class="rail-title" :title="book.title">{{ book.title }}</span>
              <p class="rail-line">
                <span v-show="pageCountLabel" class="page-count" data-testid="page-count">
                  <span class="sr-only">{{ t('reader.page') }}</span
                  >{{ pageCountLabel }}
                </span>
                <span class="rail-spend" data-testid="book-spend">{{
                  formatUsd(spend.totalForBook(book.id), language.code)
                }}</span>
              </p>
            </div>
          </Transition>
          <PageDogEar :marked="currentBookmark !== null" :exit="foldExit" />
          <!-- One slot, one panel: Bookmarks and Search take turns here, below
             the toolbar so the buttons that summon them stay reachable. -->
          <div class="side-slot">
            <!-- One at a time, and the outgoing one is gone before the next
               arrives: two panels dissolving through each other in the same
               slot would be a smear, not a change. -->
            <Transition name="panel-rise" mode="out-in">
              <SearchPanel
                v-if="sidePanel === 'search'"
                :book="book"
                :blob="blob"
                @jump="onSearchJump"
                @close="sidePanel = null"
              />
              <WordLookup
                v-else-if="sidePanel === 'lookup'"
                @ask="onLookupAsk"
                @close="closeLookup"
              />
              <AnnotationsPanel
                v-else-if="sidePanel === 'annotations'"
                :book-id="book.id"
                :format="book.format"
                @jump="onJumpTo"
                @ask="onAskAbout"
                @save="saveMarks"
                @close="sidePanel = null"
              />
            </Transition>
          </div>
        </div>
        <Transition name="pop-fade">
          <div
            v-if="editingHl"
            class="hl-editor"
            data-testid="hl-editor"
            role="dialog"
            :aria-label="t('reader.editHighlight')"
            :style="{ left: `${editingHl.x}px`, top: `${editingHl.y}px` }"
          >
            <button
              v-for="swatch in HIGHLIGHT_COLORS"
              :key="swatch.id"
              type="button"
              class="hl-dot"
              :class="{ current: (editingColor ?? '') === swatch.hex }"
              :title="t('reader.recolour', { colour: t(swatch.nameKey) })"
              :aria-label="t('reader.recolourTo', { colour: t(swatch.nameKey).toLowerCase() })"
              :data-testid="`hl-recolor-${swatch.id}`"
              @click="recolorEditingHl(swatch.hex)"
            >
              <IconInkwell class="well" :color="swatch.hex" aria-hidden="true" />
            </button>
            <i class="hl-editor-sep" aria-hidden="true"></i>
            <button
              type="button"
              class="hl-editor-x"
              data-testid="hl-editor-remove"
              :aria-label="t('reader.removeHighlight')"
              :title="t('reader.removeHighlight')"
              @click="removeEditingHl"
            >
              <IconClose class="hl-editor-x-icon" aria-hidden="true" />
            </button>
          </div>
        </Transition>
        <ChatOverlay
          ref="chatRef"
          :book="book"
          :blob="blob"
          :current-section-index="currentSectionIndex"
          :selection="lastSelection"
          :place-label="placeLabel"
          @model-change="onModelChange"
          @jump="onJumpTo"
          @clear-selection="lastSelection = null"
          @resized="refitReader"
        />
      </div>
    </template>
    <p v-else>{{ t('reader.loading') }}</p>
  </section>
</template>

<style scoped>
.reader {
  position: relative;
  display: flex;
  flex-direction: column;
  height: calc(100vh - 3.6rem);
  max-width: 58rem;
  margin: 0 auto;
  padding: 0.6rem clamp(1rem, 3vw, 1.5rem) 1rem;
  transition: max-width 0.28s var(--ease-wipe);
}
/* Detached, the assistant takes horizontal room — so the reader is allowed
   more of it, rather than halving the book to make space. */
.reader:has(.chat-side [data-dock='side']) {
  max-width: 92rem;
}
/* Book and assistant share this box; the assistant claims its own share, so
   the book is RESIZED rather than covered — the reason to have an assistant
   inside the book at all. */
.reader-body {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  position: relative;
}
.reader-body.chat-drawer {
  flex-direction: column;
}
.reader-body.chat-side {
  flex-direction: row;
}
.reader > p {
  color: var(--text-dim);
}
.reader-header {
  display: flex;
  align-items: center;
  /* Controls only, and they sit at the right — the book's own details are on
     the rail below, where the lamp already was. */
  justify-content: flex-end;
  gap: 0.55rem;
  flex-wrap: wrap;
  padding-bottom: 0.55rem;
  margin-bottom: 0.55rem;
  border-bottom: 1px solid var(--hair-soft);
}
.reader-header button {
  font-size: 0.6rem;
  padding: 0.5em 0.9em;
  white-space: nowrap;
}
/* Doubled selector so this outguns `.reader-header button`'s text padding —
   an icon button centers geometry, not glyphs. */
.reader-header .page-theme-btn {
  display: grid;
  place-items: center;
  width: 1.9rem;
  height: 1.9rem;
  padding: 0;
  letter-spacing: 0;
  border-radius: 50%;
  color: var(--text-dim);
}
.page-theme-btn:hover,
.page-theme-btn[aria-pressed='true'] {
  color: var(--gold);
  border-color: var(--hair);
}
.morph-stack {
  position: relative;
  width: 16px;
  height: 16px;
  display: block;
}
.pt-icon {
  position: absolute;
  inset: 0;
  width: 16px;
  height: 16px;
  display: block;
  transition:
    opacity 0.2s ease,
    transform 0.24s var(--ease-wipe);
}
.pt-icon.off {
  opacity: 0;
  transform: rotate(-70deg) scale(0.7);
  pointer-events: none;
}
.ctl-fixed {
  width: 16px;
  height: 16px;
  display: block;
}

/* ————— type menu: size steps and font choice ————— */
.type-wrap {
  position: relative;
}
.type-menu {
  position: absolute;
  top: calc(100% + 0.45rem);
  right: 0;
  z-index: 45;
  min-width: 13.5rem;
  padding: 0.55rem 0.65rem;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  background: var(--bg-panel);
  border: 1px solid var(--hair);
  border-radius: 3px;
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.4);
}
.type-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.type-label {
  width: 2.4rem;
  font-family: var(--font-mono);
  font-size: 0.56rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-faint);
}
.reader-header .type-step {
  font-family: var(--font-serif);
  font-size: 0.78rem;
  letter-spacing: 0;
  text-transform: none;
  padding: 0.2em 0.55em;
}
.type-value {
  min-width: 2.9rem;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.08em;
  color: var(--text);
}
.reader-header .type-font {
  font-size: 0.58rem;
  padding: 0.4em 0.7em;
}
.reader-header .type-font.active {
  color: var(--gold);
  border-color: var(--gold-deep);
}

/* Never wider than the screen it opens on; how far it then slides to stay
   inside that screen is measured when it opens (see toggleTypeMenu). */
.type-menu {
  max-width: calc(100vw - 1rem);
}

/* ————— focus mode: the book, the whole window, nothing else ————— */
.reader.focus {
  max-width: none;
  padding: 0.6rem clamp(0.75rem, 2vw, 1.25rem);
}
/* With every scrap of chrome gone the reader owns the full window height. */
.reader.focus.chrome-hidden {
  height: 100dvh;
}
.reader.chrome-hidden :deep(.controls),
.reader.chrome-hidden :deep(.chat-toggle) {
  display: none;
}
/* The assistant's button sits at the right end of the pager row (see
   ChatOverlay) rather than floating over the page, so the row leaves it the
   width. The two live in different components, which is why the room has to be
   reserved from the box that holds them both — and why the button MEASURES
   itself and publishes what it needs here rather than the row guessing. The
   guess was 8.6rem, which is "Ask the book" in English; "Pregunta al libro"
   is wider and landed on top of "Siguiente". The fallback stands only for the
   frame before the first measurement. */
.reader-stage :deep(.controls) {
  padding-inline-end: var(--chat-plate-room, 8.6rem);
}
.reader-stage {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  /* A slim rail above the page for hanging things: the lamp dangles here and
     only its base kisses the page's top edge. */
  --page-top: 3.1rem;
  padding-top: var(--page-top);
  /* How far in from the stage the PAGE begins. Zero while the page fills the
     stage; in single-page mode the pane narrows to --page-measure and centres,
     and anything hung on the page's corner has to follow it there. */
  --page-inset: 0px;
}
.reader-stage.page-narrowed {
  --page-inset: max(0px, (100% - var(--page-measure)) / 2);
}
.reader.chrome-hidden .reader-stage {
  --page-top: 0.4rem;
}

/* The shared slot the two reader panels occupy. Owning the geometry here —
   rather than letting each panel fix itself to a guessed viewport offset —
   is what keeps them off the toolbar when the header wraps, and what makes
   "they never overlap" a fact of the layout instead of a rule to remember. */
.side-slot {
  position: absolute;
  top: 0.35rem;
  inset-inline-end: 0.75rem;
  z-index: 40;
  width: min(24rem, calc(100% - 1.5rem));
}

/* The page counter shares the lamp's rail, centred over the page. */
/* ————— the rail: the book's name, its place, its cost —————
   One line across the top of the page, sharing the strip the lamp hangs in.
   The place stays exactly centred over the page — it is read at a glance and
   a glance goes to the middle — so it is centred absolutely rather than by
   the flow, which the title's length would otherwise shift. */
/* ————— the rail: the book's name, its place, its cost —————
   Wide, all three sit on ONE line across the top of the page, with the place
   centred on the page however long the title is — a three-column grid, so the
   title cannot shove the middle sideways. `display: contents` on the pair
   hands the place and the cost straight to that grid. */
.page-rail {
  position: absolute;
  top: 0.4rem;
  /* Spanning the PAGE, not the stage: a single page keeps its details over
     itself rather than over the margin beside it. */
  inset-inline-start: var(--page-inset, 0px);
  inset-inline-end: var(--page-inset, 0px);
  z-index: 20;
  height: 1.4rem;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 0.8rem;
  pointer-events: none;
}
.rail-title {
  /* Clear of the lamp, which hangs at the rail's left end. The lamp's own
     offset cannot be reused here: a percentage on a GRID ITEM's margin
     resolves against its grid area, not against the rail, so it is expressed
     against the viewport instead and checked at both ends. */
  margin-inline-start: clamp(3.6rem, 5vw + 2.4rem, 5.1rem);
  min-width: 0;
  font-family: var(--font-serif);
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rail-line {
  display: contents;
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.14em;
}
.page-count {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.16em;
  color: var(--text-faint);
  white-space: nowrap;
}
.rail-spend {
  justify-self: end;
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.1em;
  color: var(--gold);
  white-space: nowrap;
}
/* Narrow, one line will not hold all three without the title shrinking to
   nothing — so the title takes its own line above, centred, and the place and
   the cost share the one beneath it. */
@media (max-width: 640px) {
  .page-rail {
    top: 0.15rem;
    height: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.05rem;
  }
  .rail-title {
    /* Centred now, and kept narrow enough that it cannot grow out to the lamp. */
    margin-inline-start: 0;
    max-width: calc(100% - 9rem);
  }
  .rail-line {
    display: flex;
    align-items: baseline;
    gap: 0.9rem;
    margin: 0;
  }
}
.page-count .sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}

/* ————— the reading lamp: bookmark as a lantern hung over the page ————— */
.lamp-btn {
  /* The page's LEADING top corner — the trailing side belongs to the
     bookmarks/search panels. The lamp hangs over the page, so it rides the
     page's inset, and it mirrors with the reader's language. */
  position: absolute;
  top: -0.3rem;
  inset-inline-start: calc(var(--page-inset, 0px) + clamp(1.2rem, 5%, 2.6rem));
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-faint);
  cursor: pointer;
  transition: color 0.25s ease;
}
.lamp-btn:hover,
.lamp-btn:focus-visible {
  color: var(--gold-mid);
}
.lamp-btn[data-bookmarked='true'] {
  color: var(--gold);
}
.lamp-thread {
  width: 1px;
  height: 22px;
  background: linear-gradient(to bottom, transparent, currentColor);
  opacity: 0.7;
  transform-origin: top center;
}
.lamp-icon {
  width: 30px;
  height: 36px;
  display: block;
  transform-origin: top center;
  transition: filter 0.45s ease;
}
.lamp-btn[data-bookmarked='true'] .lamp-icon {
  filter: drop-shadow(0 0 7px rgba(240, 174, 47, 0.8));
}

/* ————— the pull chain: an old lamp is switched by yanking its cord ————— */
.pull-cord {
  position: absolute;
  /* Hangs from the shade's right shoulder: below thread (22px) + most of the
     icon, nudged right of the lamp's centerline. */
  top: 47px;
  left: calc(50% + 8px);
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: none;
}
.cord-line {
  width: 1px;
  height: 9px;
  background: linear-gradient(to bottom, currentColor, currentColor 60%, transparent 95%);
  opacity: 0.65;
  transform-origin: top center;
}
.cord-bead {
  width: 5px;
  height: 5px;
  margin-top: -1px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.85;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
}
.lamp-btn[data-bookmarked='true'] .cord-bead {
  background: var(--gold);
  box-shadow: 0 0 5px rgba(240, 174, 47, 0.7);
}

/* The yank: cord stretches down, lamp dips and sways on its thread, then
   everything springs back with a little overshoot. Class toggle + keyframes —
   never <Transition> for this (see LESSONS). */
.lamp-btn.pulling .cord-line {
  animation: cord-stretch 0.55s cubic-bezier(0.3, 0, 0.3, 1);
}
.lamp-btn.pulling .cord-bead {
  animation: bead-yank 0.55s cubic-bezier(0.3, 0, 0.3, 1);
}
.lamp-btn.pulling .lamp-icon {
  animation: lamp-dip 0.55s cubic-bezier(0.3, 0, 0.3, 1);
}
.lamp-btn.pulling .lamp-thread {
  animation: thread-stretch 0.55s cubic-bezier(0.3, 0, 0.3, 1);
}
@keyframes cord-stretch {
  35% {
    transform: scaleY(1.9);
  }
  60% {
    transform: scaleY(0.85);
  }
  80% {
    transform: scaleY(1.06);
  }
}
@keyframes bead-yank {
  35% {
    transform: translateY(11px);
  }
  60% {
    transform: translateY(-2px);
  }
  80% {
    transform: translateY(1px);
  }
}
@keyframes lamp-dip {
  35% {
    transform: translateY(3px) rotate(3.5deg);
  }
  60% {
    transform: translateY(-1px) rotate(-2.5deg);
  }
  80% {
    transform: rotate(1deg);
  }
}
@keyframes thread-stretch {
  35% {
    transform: scaleY(1.14);
  }
  60% {
    transform: scaleY(0.96);
  }
}

.lamp-tip {
  /* Out of flow so its width can never shove the lamp sideways, and beside
     the lantern rather than beneath it — below is the page, where the
     bookmarked corner folds down. */
  position: absolute;
  top: 2.4rem;
  left: calc(100% + 0.5rem);
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 0.54rem;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--text-faint);
  opacity: 0;
  transform: translate(-5px, -50%);
  transition:
    opacity 0.25s ease,
    transform 0.25s ease;
  pointer-events: none;
}
.lamp-btn:hover .lamp-tip,
.lamp-btn:focus-visible .lamp-tip {
  opacity: 1;
  transform: translate(0, -50%);
}
.lamp-btn[data-bookmarked='true'] .lamp-tip {
  color: var(--gold);
}

/* ————— round-belly inkwells (shared by both floating popovers) ————— */
.hl-word {
  font-family: var(--font-mono);
  font-size: 0.56rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
  margin-inline-end: 0.15rem;
}
.hl-dot .well {
  width: 100%;
  height: 100%;
  display: block;
}
.hl-dot :deep(.ink) {
  transition: transform 0.35s ease;
}
.hl-dot:hover {
  transform: translateY(-2px);
  filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.4));
}
.hl-dot:hover :deep(.ink) {
  transform: translateY(-3.4px);
}

/* ————— the ink: one well that opens sideways into the palette —————
   It lives in the toolbar, and not over the selected words, because that is
   where the phone's own copy/translate bar lands — and that bar is browser
   chrome, which no z-index of ours can rise above. It opens in PLACE rather
   than as a menu: the row is right-aligned with room to its left, so growing
   sideways covers nothing and needs no popover to be fitted to a screen. */
/* One ring around the whole thing: closed it is the circle every other
   control wears; open it stretches into a pill that holds the palette, so the
   colours read as the well's own contents rather than as a row parked beside
   it. The ring therefore belongs to the WRAP — the button inside gives up its
   own border, and the states (hover, waiting) move up with it. */
.ink-wrap {
  display: flex;
  align-items: center;
  /* No gap: closed, it would hold the ring open into an oval. The breathing
     room between the well and the palette lives INSIDE the strip, where it is
     folded away with it. */
  gap: 0;
  height: 1.9rem;
  padding: 0 0.14rem;
  border: 1px solid var(--hair-soft);
  border-radius: 999px;
  transition:
    border-color 0.22s ease,
    color 0.22s ease;
}
.ink-wrap:hover,
.ink-wrap.open {
  border-color: var(--hair);
}
.ink-wrap.pending {
  border-color: var(--gold);
}
.reader-header .ink-btn {
  width: 1.48rem;
  height: 1.48rem;
  border: 0;
  background: none;
}
.reader-header .ink-btn:hover,
.reader-header .ink-btn.pending {
  border: 0;
}
.ctl-well {
  width: 17px;
  height: 20px;
  display: block;
}
/* The toolbar well is drawn brim-full (see IconInkwell's `full`): at 16-odd
   pixels a half-filled jar reads as an empty one. */
.ink-strip {
  display: flex;
  align-items: center;
  gap: 0.28rem;
  /* Folded away by width, not by v-if, so the two states are one animation
     and nothing is measured or positioned. */
  max-width: 0;
  opacity: 0;
  overflow: hidden;
  transition:
    max-width 0.3s var(--ease-wipe, ease),
    opacity 0.2s ease;
}
.ink-wrap.open .ink-strip {
  /* The breathing room appears with the strip: a padding that lived here all
     the time would hold the closed ring open by its own width. */
  padding-inline-start: 0.28rem;
  max-width: 12rem;
  opacity: 1;
}
.reader-header .ink-strip .hl-dot {
  flex-shrink: 0;
  width: 1.15rem;
  /* As tall as the buttons beside it: the well is small, but the thing a
     thumb has to hit does not have to be. Height is free here — the row is
     already this tall — where width is the thing in short supply. */
  height: 1.9rem;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
  transition:
    transform 0.2s ease,
    filter 0.2s ease;
}
.reader-header .ink-strip .well {
  width: 1.15rem;
  height: 1.4rem;
}
.reader-header .ink-strip .hl-dot.current {
  filter: drop-shadow(0 0 4px rgba(240, 174, 47, 0.7));
}

/* A phone's toolbar has room for the strip, but not much: the icons close
   ranks and the wells run narrower. And the row is forbidden to wrap — a
   second row would push the book down and re-flow it mid-selection — so on a
   screen too narrow even for that, the strip scrolls instead of wrapping. */
@media (max-width: 640px) {
  .reader-header {
    gap: 0.4rem;
    flex-wrap: nowrap;
  }
  .reader-header > * {
    flex-shrink: 0;
  }
  .ink-wrap {
    min-width: 0;
    flex-shrink: 1;
  }
  .ink-strip {
    gap: 0.2rem;
  }
  .ink-wrap.open .ink-strip {
    overflow-x: auto;
    scrollbar-width: none;
  }
  .reader-header .ink-strip .hl-dot,
  .reader-header .ink-strip .well {
    width: 1rem;
  }
}
/* Narrower still: the icons close ranks again and the wells run to their
   smallest, which is what keeps all five in view on a 360px phone. */
@media (max-width: 380px) {
  .reader-header {
    gap: 0.3rem;
  }
  .reader-header .page-theme-btn {
    width: 1.75rem;
    height: 1.75rem;
  }
  .reader-header .ink-strip .hl-dot,
  .reader-header .ink-strip .well {
    width: 0.9rem;
  }
}

/* Focus mode: the toolbar returns over the page, not into the layout. */
.reader-header.peek {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 30;
  margin-bottom: 0;
  padding: 0.5rem clamp(0.75rem, 2vw, 1.25rem);
  background: var(--bg);
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.5);
}

/* ————— in-book highlight editor: recolor or snuff out a wash ————— */
.hl-editor {
  position: fixed;
  z-index: 55;
  transform: translate(-50%, calc(-100% - 12px));
  display: flex;
  align-items: center;
  gap: 0.32rem;
  padding: 0.4rem 0.5rem;
  background: var(--bg-panel);
  border: 1px solid var(--hair);
  border-radius: 3px;
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.45);
}
.hl-editor .hl-dot {
  width: 1.2rem;
  height: 1.45rem;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
  transition:
    transform 0.2s ease,
    filter 0.2s ease;
}
.hl-editor .hl-dot.current {
  filter: drop-shadow(0 0 4px rgba(240, 174, 47, 0.7));
}
.hl-editor-sep {
  width: 1px;
  height: 1.1rem;
  background: var(--hair);
  margin: 0 0.15rem;
}
.hl-editor-x {
  display: grid;
  place-items: center;
  width: 1.45rem;
  height: 1.45rem;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 50%;
  background: none;
  color: var(--text-faint);
}
.hl-editor-x:hover:not(:disabled) {
  color: var(--danger);
  border-color: var(--hair-soft);
  background: none;
}
.hl-editor-x-icon {
  width: 12px;
  height: 12px;
  display: block;
}
</style>
