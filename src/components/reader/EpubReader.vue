<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { isTextEntryTarget } from '@/lib/keyboard'
import { DEFAULT_HIGHLIGHT_HEX } from '@/lib/highlight'
import { LOCATION_CHARS, pageFromLocation } from '@/lib/pagination'
import { getBookLocations, saveBookLocations } from '@/services/db'
import type { Annotation } from '@/lib/types'
import {
  isPaperish,
  needsNightInk,
  parseColor,
  NIGHT_BG,
  NIGHT_INK,
  NIGHT_LINK,
} from '@/lib/nightPage'
import { useI18n } from '@/i18n'
import { flattenToc, tocPath, type TocEntry } from '@/lib/toc'
import TocMenu from '@/components/reader/TocMenu.vue'
import type { Book, Rendition } from 'epubjs'

const props = defineProps<{
  bookId: string
  blob: Blob
  initialPosition: string | null
  highlights?: readonly Annotation[]
  pageTheme?: 'light' | 'dark'
  /** Body text scale, percent (100 = the book's own size). */
  fontSize?: number
  fontFamily?: 'book' | 'serif' | 'sans'
  /** One page at a time, or a two-page spread where the pane allows it. */
  spread?: 'single' | 'double'
  /** Pages you turn, or one continuous strip you scroll. */
  flow?: 'paged' | 'scroll'
}>()
const emit = defineEmits<{
  positionChange: [position: string]
  selection: [text: string, position: string, context: string]
  sectionChange: [index: number]
  highlightClick: [id: string, x: number, y: number]
  /** A plain tap/click on the page; fraction is 0..1 across the visible pane. */
  pageTap: [fraction: number]
  swipe: [direction: 'left' | 'right']
  /** CFI span of what's on screen — how the view knows which marks are here. */
  rangeChange: [start: string, end: string]
  /** Synthetic page counter; total is 0 until the pagination is ready. */
  pageMetrics: [current: number, total: number]
}>()

const { t } = useI18n()

const container = ref<HTMLDivElement | null>(null)
const ready = ref(false)
const error = ref<string | null>(null)
const toc = ref<TocEntry[]>([])
/** Href of the section on screen, so the contents can mark where you are. */
const currentHref = ref<string | null>(null)

let book: Book | null = null
let rendition: Rendition | null = null

/**
 * An EPUB has no pages, so epub.js invents them by walking every section's
 * text — seconds of work on a long book. It runs OFF the critical path (the
 * reader is already readable) and its result is cached, so this is paid once
 * per book rather than once per open.
 */
interface EpubLocations {
  load: (json: string) => void
  generate: (chars: number) => Promise<unknown>
  save: () => string
  length: () => number
  locationFromCfi: (cfi: string) => number
}
let paginated = false
/** Last relocation, so the counter can fill in the moment pages exist. */
let lastCfi: string | null = null

function locationsOf(target: Book): EpubLocations {
  return (target as unknown as { locations: EpubLocations }).locations
}

function reportPage(cfi: string): void {
  lastCfi = cfi
  if (!book || !paginated) return
  const locations = locationsOf(book)
  const total = locations.length()
  emit('pageMetrics', pageFromLocation(locations.locationFromCfi(cfi), total), total)
}

async function preparePagination(target: Book): Promise<void> {
  const locations = locationsOf(target)
  try {
    const cached = await getBookLocations(props.bookId, LOCATION_CHARS)
    if (cached !== undefined) {
      locations.load(cached)
    } else {
      await locations.generate(LOCATION_CHARS)
      await saveBookLocations({
        bookId: props.bookId,
        json: locations.save(),
        chars: LOCATION_CHARS,
      })
    }
  } catch {
    // A book we can't paginate still reads fine — the counter just stays away.
    return
  }
  if (book !== target) return // a different book was opened meanwhile
  paginated = true
  if (lastCfi !== null) reportPage(lastCfi)
}

/**
 * epub.js listens to WINDOW resizes, but focus mode (and layout shifts)
 * change only the CONTAINER — leaving the columns laid out for the old
 * width, so slivers of neighboring pages bleed in. Watch the container
 * itself and tell the rendition its honest new size.
 */
let resizeObserver: ResizeObserver | null = null
let resizeTimer = 0
let lastPaneWidth = 0
let lastPaneHeight = 0

/**
 * Hand the rendition the pane's true current size, synchronously. Called in
 * the same tick as a known layout change (focus toggles) so the pane and
 * the re-laid-out page land in the SAME paint — no stale-width beat, which
 * is what read as a glitch.
 */
function refit(): void {
  const pane = container.value
  if (!pane || !rendition) return
  const width = pane.clientWidth
  const height = pane.clientHeight
  if (Math.abs(width - lastPaneWidth) < 2 && Math.abs(height - lastPaneHeight) < 2) return
  lastPaneWidth = width
  lastPaneHeight = height
  try {
    ;(rendition as unknown as { resize: (w: number, h: number) => void }).resize(width, height)
  } catch (cause) {
    console.warn('[bookworm] epub resize failed', cause)
  }
}

/** Fallback for resizes nobody announces (window drags, panel shifts). */
function watchPaneSize(): void {
  if (!container.value || typeof ResizeObserver === 'undefined') return
  lastPaneWidth = container.value.clientWidth
  lastPaneHeight = container.value.clientHeight
  resizeObserver = new ResizeObserver(() => {
    window.clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(refit, 140)
  })
  resizeObserver.observe(container.value)
}

/** epub.js's annotation layer, minimally typed (its own types omit it). */
interface EpubAnnotations {
  highlight: (
    cfiRange: string,
    data?: object,
    cb?: (event: Event) => void,
    className?: string,
    styles?: Record<string, string>,
  ) => unknown
  remove: (cfiRange: string, type: string) => unknown
}

const appliedHighlights = new Map<string, { cfi: string; color: string }>()

/**
 * The block of prose a selection was made in — the paragraph, list item or
 * cell, not the whole chapter. It is the context a single word needs to be
 * glossed, and it comes from inside the iframe because that is where the
 * book's own document lives.
 */
const BLOCK_TAGS = 'p,li,blockquote,dd,dt,td,th,h1,h2,h3,h4,h5,h6,section,div,body'
const MAX_CONTEXT_CHARS = 1200

function blockTextAround(selection: Selection | null): string {
  const node = selection?.anchorNode ?? null
  if (!node) return ''
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element)
  const block = element?.closest?.(BLOCK_TAGS) ?? element
  const text = block?.textContent ?? ''
  if (text.length <= MAX_CONTEXT_CHARS) return text
  // A chapter wrapped in a single <div> would otherwise hand over the whole
  // chapter. Trim it AROUND the selected words rather than from the front —
  // a window that does not contain the word is worse than no window at all.
  const at = text.indexOf(selection?.toString() ?? '')
  const from = at === -1 ? 0 : Math.max(0, at - MAX_CONTEXT_CHARS / 2)
  return text.slice(from, from + MAX_CONTEXT_CHARS)
}

/** Clicking a wash opens the editor. The marks pane proxies iframe clicks
 *  onto its marks with a CLONED event that loses clientX/Y (Object.assign
 *  over an Event copies no coordinates), so the event is useless for
 *  placement. The mark element itself lives in the MAIN document though, so
 *  its bounding rect gives honest viewport coordinates: anchor at the wash's
 *  top center. */
function onMarkClick(id: string, event: Event): void {
  const target = event.target as Element | null
  const mark = target?.closest('.bw-hl') ?? target
  // A wash that flows onto the next page has line rects laid out in columns
  // PAST the reading pane — hidden by the container's overflow clipping, not
  // by the viewport, so they can still overlap the window. Anchor to the
  // topmost line rect inside the CONTAINER's box, the real visible area.
  const bounds = container.value?.getBoundingClientRect()
  let best: DOMRect | null = null
  for (const line of mark?.querySelectorAll('rect') ?? []) {
    const rect = line.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) continue
    const visible = bounds
      ? rect.right > bounds.left + 1 &&
        rect.left < bounds.right - 1 &&
        rect.bottom > bounds.top + 1 &&
        rect.top < bounds.bottom - 1
      : rect.right > 0 &&
        rect.left < window.innerWidth &&
        rect.bottom > 0 &&
        rect.top < window.innerHeight
    if (visible && (!best || rect.top < best.top)) best = rect
  }
  if (best) {
    emit('highlightClick', id, best.left + best.width / 2, best.top)
    return
  }
  // Fallback: center of the reading pane.
  const frame = container.value?.getBoundingClientRect()
  emit(
    'highlightClick',
    id,
    (frame?.left ?? 0) + (frame?.width ?? 600) / 2,
    (frame?.top ?? 0) + 160,
  )
}

/** Mirror the saved highlights into epub.js's SVG annotation layer. */
function syncHighlights(): void {
  if (!rendition) return
  const layer = (rendition as unknown as { annotations: EpubAnnotations }).annotations
  // Multiply sinks pastels into a light page; on the night page it would just
  // vanish, so there the wash screen-blends (and fades a little) instead.
  const dark = props.pageTheme === 'dark'
  const wanted = new Map((props.highlights ?? []).map((item) => [item.id, item]))
  for (const [id, applied] of appliedHighlights) {
    const want = wanted.get(id)
    // Gone, or recolored: redraw from scratch.
    if (want && (want.color ?? DEFAULT_HIGHLIGHT_HEX) === applied.color) continue
    try {
      layer.remove(applied.cfi, 'highlight')
    } catch {
      // A view that never rendered this range has nothing to remove.
    }
    appliedHighlights.delete(id)
  }
  for (const [id, item] of wanted) {
    if (appliedHighlights.has(id)) continue
    const color = item.color ?? DEFAULT_HIGHLIGHT_HEX
    try {
      layer.highlight(item.position, {}, (event: Event) => onMarkClick(id, event), 'bw-hl', {
        fill: color,
        'fill-opacity': dark ? '0.3' : '0.45',
        'mix-blend-mode': dark ? 'screen' : 'multiply',
        cursor: 'pointer',
      })
      appliedHighlights.set(id, { cfi: item.position, color })
    } catch (cause) {
      console.warn('[bookworm] could not draw highlight', cause)
    }
  }
}

/** Redraw every wash with the blend mode the current page theme needs. */
function reapplyHighlights(): void {
  if (!rendition) return
  const layer = (rendition as unknown as { annotations: EpubAnnotations }).annotations
  for (const [id, applied] of appliedHighlights) {
    try {
      layer.remove(applied.cfi, 'highlight')
    } catch {
      // Nothing rendered for this range yet.
    }
    appliedHighlights.delete(id)
  }
  syncHighlights()
}

watch(() => props.highlights, syncHighlights, { deep: true })

/**
 * Night page for the EPUB iframes. epub.js's themes.select() layers the new
 * theme's rules without reliably removing the old ones (caught by the probe:
 * switching back to light kept the coal page), so a <style> tag is injected
 * into and removed from each view's document directly instead.
 */
const PAGE_THEME_STYLE_ID = 'bw-page-theme'
/**
 * The page's ground and its default ink, and nothing else.
 *
 * This used to carry `color: inherit !important` for a list of tags, which was
 * wrong twice over. `inherit` is not "the page's colour", it is "my parent's" —
 * so a `<ul>`, `<section>` or `<header>` the list had forgotten handed the
 * publisher's black down to every child that WAS listed, and a table of
 * contents came out black on coal. And where it did work it was indiscriminate:
 * a book that colours something deliberately, and legibly, lost it.
 *
 * What is left here is only what the page itself owns. Anything the publisher
 * set explicitly is judged one element at a time by `repaintUnreadable` below,
 * and kept unless it cannot be read.
 *
 * `a[href]`, not `a`: an `<a id="note4">` with no href is a landing place, not
 * a link. EPUBs are full of them, they are frequently left unclosed, and the
 * HTML parser then runs one on until the next anchor — so colouring bare `a`
 * painted half a chapter gold.
 */
const DARK_PAGE_CSS = `
  html, body { background: ${NIGHT_BG} !important; color: ${NIGHT_INK} !important; }
  a[href] { color: ${NIGHT_LINK} !important; }
  a[href]:visited { color: #d1921e !important; }
`

/** Marks an element this pass has repainted, so it can be put back exactly. */
const NIGHT_INK_MARK = 'data-bw-night-ink'
const NIGHT_BG_MARK = 'data-bw-night-bg'

/**
 * The ground this element will actually be read against.
 *
 * Walks up until something paints, because `background-color` does not
 * inherit: an element's own is `transparent` far more often than not, and what
 * the reader sees behind it is whichever ancestor last drew. Anything this pass
 * has already cleared is skipped — it is showing the night page now.
 */
function groundBehind(element: Element, view: Window): string {
  let node: Element | null = element
  while (node !== null) {
    if (!node.hasAttribute(NIGHT_BG_MARK)) {
      const painted = view.getComputedStyle(node).backgroundColor
      const colour = parseColor(painted)
      if (colour !== null && colour.a > 0) return painted
    }
    node = node.parentElement
  }
  return NIGHT_BG
}

/**
 * Repaint only what the night page has made unreadable.
 *
 * Every element is asked one question — can the ink it ended up with be read on
 * the ground behind it — and left alone unless the answer is no. A publisher's
 * grey aside stays a grey aside; their black body text becomes the page's ink.
 *
 * Paper-white panels go first, and for the same reason: a pale box drawn behind
 * a sidebar is a white slab on a dark page, and dropping it lets the coal show
 * through. Dropping it BEFORE measuring also matters — the text on top of it is
 * then judged against the night, which is what it will really be sitting on.
 *
 * Inline styles, tracked by attribute, so switching back to the day page puts
 * the book exactly as its publisher wrote it.
 */
function repaintUnreadable(doc: Document, dark: boolean): void {
  const marked = Array.from(
    doc.querySelectorAll<HTMLElement>(`[${NIGHT_INK_MARK}], [${NIGHT_BG_MARK}]`),
  )
  for (const element of marked) {
    element.style.removeProperty('color')
    element.style.removeProperty('background-color')
    element.removeAttribute(NIGHT_INK_MARK)
    element.removeAttribute(NIGHT_BG_MARK)
  }
  if (!dark) return
  const view = doc.defaultView
  if (view === null) return

  const elements = Array.from(doc.body?.querySelectorAll('*') ?? [])
  for (const element of elements) {
    if (!(element instanceof view.HTMLElement)) continue
    if (isPaperish(view.getComputedStyle(element).backgroundColor)) {
      element.style.setProperty('background-color', 'transparent', 'important')
      element.setAttribute(NIGHT_BG_MARK, '')
    }
  }
  for (const element of elements) {
    if (!(element instanceof view.HTMLElement)) continue
    // The anchor ITSELF is the stylesheet's business, and that rule carries
    // !important, so an inline colour here would only be one that never wins.
    //
    // What is emphatically not skipped is everything INSIDE it. `color` is
    // inherited, and inheritance is exactly what a child with a colour of its
    // own does not do: a publisher's `<a href><h1 class="title">` leaves the
    // anchor's gold nowhere near the heading. Skipping the whole subtree was
    // this pass's own blind spot — the headings and contents entries that
    // stayed black on black were every one of them inside a link.
    if (element.matches('a[href]')) continue
    const ink = view.getComputedStyle(element).color
    if (!needsNightInk(ink, groundBehind(element, view))) continue
    // Inside a link the readable colour is the LINK's, so the repaint does not
    // quietly turn a piece of a link into body prose.
    const readable = element.closest('a[href]') === null ? NIGHT_INK : NIGHT_LINK
    element.style.setProperty('color', readable, 'important')
    element.setAttribute(NIGHT_INK_MARK, '')
  }
}

const FONT_STACKS: Record<'serif' | 'sans', string> = {
  serif: "Georgia, 'Iowan Old Style', 'Times New Roman', serif",
  sans: "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
}

/** One injected style tag per view: night colors + the reader's typography. */
function buildPageCss(): string {
  let css = ''
  if (props.pageTheme === 'dark') css += DARK_PAGE_CSS
  // html only: html AND body together would compound (120% -> 144%).
  const size = props.fontSize ?? 100
  if (size !== 100) css += `\n  html { font-size: ${size}% !important; }`
  const family = props.fontFamily ?? 'book'
  if (family !== 'book') {
    css += `\n  body, p, div, span, li, blockquote, h1, h2, h3, h4, h5, h6, td, th, dt, dd {
      font-family: ${FONT_STACKS[family]} !important;
    }`
  }
  return css
}

function applyPageTheme(): void {
  if (!rendition) return
  const views = (
    rendition as unknown as { getContents: () => Array<{ document?: Document }> }
  ).getContents()
  const css = buildPageCss()
  for (const view of views) {
    const doc = view.document
    if (!doc) continue
    doc.getElementById(PAGE_THEME_STYLE_ID)?.remove()
    if (css.length > 0) {
      const style = doc.createElement('style')
      style.id = PAGE_THEME_STYLE_ID
      style.textContent = css
      doc.head.appendChild(style)
    }
    // After the stylesheet, never before: the pass measures what the element
    // ACTUALLY computes to, and the page's own rules are part of that.
    repaintUnreadable(doc, props.pageTheme === 'dark')
  }
  reapplyHighlights()
}

watch(
  () => props.pageTheme,
  () => applyPageTheme(),
)

watch(
  () => [props.fontSize, props.fontFamily],
  () => {
    applyPageTheme()
    // The text reflowed under the washes and the current page boundary
    // moved; re-displaying the known position re-renders both correctly.
    const cfi = container.value?.dataset.currentCfi
    if (cfi) void rendition?.display(cfi)
  },
)

/**
 * epub.js's 'auto' gives two columns when the pane is wide enough and one when
 * it isn't — so 'double' is a ceiling rather than a demand, and a phone still
 * reads as a single page. 'none' forces one column at any width.
 */
function spreadMode(): 'none' | 'auto' {
  return props.spread === 'single' ? 'none' : 'auto'
}

/**
 * 'scrolled-doc' hands the whole section to the pane as one tall document and
 * lets the pane scroll it; 'paginated' cuts it into columns the width of the
 * pane. Everything else — locations, CFIs, the marks layer — is the same in
 * both, so the page counter and the highlights carry across unchanged.
 */
function flowMode(): 'scrolled-doc' | 'paginated' {
  return props.flow === 'scroll' ? 'scrolled-doc' : 'paginated'
}

const scrolling = (): boolean => props.flow === 'scroll'

watch(
  () => props.flow,
  async () => {
    if (!rendition) return
    ;(rendition as unknown as { flow: (mode: string) => void }).flow(flowMode())
    // Same dance as the spread: the pane changes shape, so hand the rendition
    // its true size in the same tick, then say the place again — re-laying the
    // text out from columns into a strip loses it otherwise.
    await nextTick()
    refit()
    const cfi = container.value?.dataset.currentCfi
    if (cfi) void rendition.display(cfi)
  },
)

watch(
  () => props.spread,
  async () => {
    if (!rendition) return
    const layout = rendition as unknown as { spread: (mode: string) => void }
    layout.spread(spreadMode())
    // The single-page pane is narrower, so wait for that class to land and
    // hand the rendition its true new size in the same tick — the same
    // synchronous refit focus mode needed, for the same reason (LESSONS).
    await nextTick()
    refit()
    // Changing the column count re-paginates from scratch, which resize()
    // alone won't do — re-display the known CFI so the reader keeps their
    // place and the washes re-anchor to the new pages.
    const cfi = container.value?.dataset.currentCfi
    if (cfi) void rendition.display(cfi)
  },
)

function next(): void {
  void rendition?.next()
}

function previous(): void {
  void rendition?.prev()
}

function onKeydown(event: KeyboardEvent): void {
  // Arrows inside inputs/textareas (e.g. the chat composer) move the caret,
  // not the book.
  if (isTextEntryTarget(event.target)) return
  if (event.key === 'ArrowRight') next()
  else if (event.key === 'ArrowLeft') previous()
  else if (event.key === 'Escape' && (event.target as Node | null)?.ownerDocument !== document) {
    // Esc pressed INSIDE the book's iframe never reaches the main document's
    // listeners (focus-mode exit, popover dismissal) — forward it.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  }
}

// Restore state: epub.js often lands one page BEFORE the requested CFI on the
// first display() after load (layout not settled), and that spurious position
// must never be persisted or every reload walks backwards one page (see
// Docs/LESSONS.md 2026-09-01). We ignore relocations while restoring, verify
// the landing page actually contains the target, and retry the display once.
let restoring = false
let restoreRetried = false
/**
 * A chapter the reader has just asked for, held until the book agrees it is
 * there. Opening a book and going straight to a chapter used to bounce back:
 * a display() resolves before the view has settled, so the opening relocation
 * arrives AFTER the jump and puts the reader back where they started. Waiting
 * on promises does not fix it — the fix is to notice the disagreement and say
 * it again, which is the same verify-and-retry the restore already does.
 */
let jumpHref: string | null = null
let jumpRetried = false
let jumpTimer = 0
const JUMP_WINDOW_MS = 2000

onMounted(async () => {
  if (!container.value) return
  try {
    const { default: ePub, EpubCFI } = await import('epubjs')
    book = ePub(await props.blob.arrayBuffer())
    await book.ready
    // Covers and title pages are often marked linear="no" in the spine, and
    // epub.js makes non-linear sections dead ends: their next()/prev() are
    // assigned as no-ops at load time, so the cover is unreachable by
    // keyboard and a trap after a TOC jump. Rewire every section to be
    // navigable in plain spine order, but remember where the book properly
    // starts (first linear section) so a fresh open still lands there
    // rather than on the cover.
    interface PatchableSpineItem {
      linear: boolean
      href: string
      next: () => PatchableSpineItem | undefined
      prev: () => PatchableSpineItem | undefined
    }
    const spineItems: PatchableSpineItem[] = []
    book.spine.each((item: PatchableSpineItem) => {
      spineItems.push(item)
    })
    let firstLinearHref: string | undefined
    spineItems.forEach((item, itemIndex) => {
      if (firstLinearHref === undefined && item.linear) firstLinearHref = item.href
      item.linear = true
      item.next = () => spineItems[itemIndex + 1]
      item.prev = () => spineItems[itemIndex - 1]
    })
    rendition = book.renderTo(container.value, {
      width: '100%',
      height: '100%',
      allowScriptedContent: false,
      spread: spreadMode(),
      flow: flowMode(),
    })
    // New section views arrive as bare documents; restyle each as it renders.
    rendition.on('rendered', () => applyPageTheme())
    watchPaneSize()

    const target = props.initialPosition
    // The restore check below asks a CFI comparator whether we landed on the
    // right page — so it only applies to a CFI. A book opened AT something
    // (the shelf search sends a spine href) has no page to verify against, and
    // handing an href to EpubCFI throws.
    restoring = typeof target === 'string' && target.startsWith('epubcfi(')

    rendition.on(
      'relocated',
      (location: {
        start?: { cfi?: string; index?: number; href?: string }
        end?: { cfi?: string }
      }) => {
        const startCfi = location?.start?.cfi
        const endCfi = location?.end?.cfi
        const startHref = location?.start?.href
        if (typeof startHref === 'string') {
          currentHref.value = startHref
          // Landed somewhere other than the chapter just chosen: say it once
          // more. Once is enough — twice would be a fight, not a correction.
          if (jumpHref && tocPath(startHref) !== tocPath(jumpHref)) {
            if (!jumpRetried) {
              jumpRetried = true
              void rendition?.display(jumpHref)
              return
            }
          } else if (jumpHref) {
            jumpHref = null
          }
        }
        if (typeof location?.start?.index === 'number') emit('sectionChange', location.start.index)
        if (typeof startCfi !== 'string') return
        // Exposed for E2E tests and debugging.
        if (container.value) container.value.dataset.currentCfi = startCfi
        // Announced on every relocation — including during the restore, and
        // after a re-flow — so the view always knows the visible span.
        emit('rangeChange', startCfi, typeof endCfi === 'string' ? endCfi : startCfi)
        // Before the restore branch: the counter should be honest about where
        // we are even on the landing page of a reopen.
        reportPage(startCfi)

        if (restoring && typeof target === 'string') {
          const comparator = new EpubCFI()
          const targetAfterPage =
            typeof endCfi === 'string' && comparator.compare(target, endCfi) > 0
          const targetBeforePage = comparator.compare(target, startCfi) < 0
          if ((targetAfterPage || targetBeforePage) && !restoreRetried) {
            restoreRetried = true
            void rendition?.display(target)
            return
          }
          restoring = false
          return
        }
        emit('positionChange', startCfi)
      },
    )

    rendition.on('selected', (cfiRange: string, contents: { window: Window }) => {
      const selection = contents.window.getSelection()
      const text = selection?.toString() ?? ''
      if (text.trim().length === 0) return
      // No rect is lifted out of the iframe any more: the ink lives in the
      // toolbar, so nothing is positioned against the selected words. What
      // DOES come out is the paragraph the words were taken from, so a single
      // word can be looked up in the sentence it belongs to.
      emit('selection', text.trim(), cfiRange, blockTextAround(selection ?? null))
    })

    // Relayed from inside the iframe (epub.js passes the ORIGINAL event, so
    // its coords are trustworthy — unlike marks-pane clones, see LESSONS).
    // Coords are iframe-space; project into the visible pane for tap zones.
    let pointerDownX = 0
    let pointerDownY = 0
    rendition.on('mousedown', (event: MouseEvent) => {
      pointerDownX = event.clientX
      pointerDownY = event.clientY
    })
    rendition.on('click', (event: MouseEvent) => {
      // A press that traveled is a selection drag, not a tap — the browser
      // still fires click on the common ancestor after a drag.
      if (Math.hypot(event.clientX - pointerDownX, event.clientY - pointerDownY) > 8) return
      // A live selection inside the BOOK's document means the reader is
      // highlighting (the main document's selection stays empty for epubs).
      const views = (
        rendition as unknown as { getContents: () => Array<{ window?: Window }> }
      ).getContents()
      for (const view of views) {
        const selection = view.window?.getSelection?.()
        if (selection && !selection.isCollapsed) return
      }
      // Scrolling has no page edges to tap: a tap is only ever "show me the
      // chrome", which is what the middle of the pane means.
      const iframeRect = container.value?.querySelector('iframe')?.getBoundingClientRect()
      const paneRect = container.value?.getBoundingClientRect()
      if (scrolling() || !iframeRect || !paneRect || paneRect.width === 0) {
        emit('pageTap', 0.5)
        return
      }
      const viewportX = iframeRect.left + event.clientX
      const fraction = (viewportX - paneRect.left) / paneRect.width
      emit('pageTap', Math.min(Math.max(fraction, 0), 1))
    })

    // Swipes, from the relayed touch events.
    let touchStartX = 0
    let touchStartY = 0
    rendition.on('touchstart', (event: TouchEvent) => {
      const touch = event.changedTouches[0]
      if (!touch) return
      touchStartX = touch.clientX
      touchStartY = touch.clientY
    })
    rendition.on('touchend', (event: TouchEvent) => {
      // A sideways drift during a scroll is not a page turn.
      if (scrolling()) return
      const touch = event.changedTouches[0]
      if (!touch) return
      const dx = touch.clientX - touchStartX
      const dy = touch.clientY - touchStartY
      if (Math.abs(dx) > 55 && Math.abs(dy) < Math.abs(dx) * 0.6) {
        emit('swipe', dx < 0 ? 'left' : 'right')
      }
    })

    // Arrow keys pressed while focus is inside the epub iframe
    rendition.on('keydown', onKeydown)

    const navigation = await book.loaded.navigation
    await rendition.display(target ?? firstLinearHref)
    // The contents is offered only once the book has actually opened. Listed
    // any earlier, a chapter chosen straight away was overridden by the
    // opening display() itself — the reader tapped Chapter 2 and the book
    // arrived at Chapter 1 a moment later, with nothing to show why.
    // Depth is kept as a number rather than baked into the label with spaces:
    // the menu indents with CSS, which a <select> could not do.
    toc.value = flattenToc(navigation.toc as unknown[])
    syncHighlights()
    // Safety valve: if no further 'relocated' arrives (retry landed on the
    // same page), stop treating events as part of the restore.
    setTimeout(() => {
      restoring = false
    }, 1500)
    ready.value = true
    // Deliberately unawaited: the book is readable now, and the page count
    // arrives when it arrives.
    void preparePagination(book)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('reader.epubFailed')
  }
})

function goToPosition(position: string): void {
  // A deliberate jump ends the restore: the reader has just said where they
  // want to be, and the saved place is no longer the answer.
  restoring = false
  // Only chapter hrefs are watched for a bounce-back; a CFI jump (a bookmark,
  // a search hit) is already an exact place inside a section.
  if (!position.includes('epubcfi(')) {
    jumpHref = position
    jumpRetried = false
    window.clearTimeout(jumpTimer)
    jumpTimer = window.setTimeout(() => {
      jumpHref = null
    }, JUMP_WINDOW_MS)
  }
  void rendition?.display(position)
}

const FLASH_MS = 2500

/**
 * Jump to the exact occurrence of `term` inside the section at `position` and
 * flash it briefly. Falls back to the section start when no match is found.
 */
async function goToMatch(position: string, term: string): Promise<void> {
  if (!book || !rendition) return
  try {
    const section = book.spine.get(position) as unknown as {
      load: (loader: unknown) => Promise<unknown>
      find: (query: string) => Array<{ cfi: string }>
    } | null
    if (section) {
      await section.load(book.load.bind(book))
      const matches = section.find(term)
      const first = matches[0]
      if (first) {
        await rendition.display(first.cfi)
        rendition.annotations.highlight(first.cfi, {}, undefined, 'search-flash', {
          fill: '#ffd400',
          'fill-opacity': '0.45',
        })
        setTimeout(() => {
          rendition?.annotations.remove(first.cfi, 'highlight')
        }, FLASH_MS)
        return
      }
    }
  } catch {
    // Fall through to the plain section jump below.
  }
  goToPosition(position)
}

function onTocSelect(href: string): void {
  goToPosition(href)
}

defineExpose({ goToPosition, goToMatch, next, previous, refit })

window.addEventListener('keydown', onKeydown)
onBeforeUnmount(() => {
  window.clearTimeout(jumpTimer)
  window.removeEventListener('keydown', onKeydown)
  window.clearTimeout(resizeTimer)
  resizeObserver?.disconnect()
  rendition?.destroy()
  book?.destroy()
})
</script>

<template>
  <div class="epub-reader">
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div
      ref="container"
      class="epub-container"
      :class="{
        'page-dark': pageTheme === 'dark',
        'one-up': spread === 'single',
        scrolling: flow === 'scroll',
      }"
      data-testid="epub-container"
    ></div>
    <div v-if="ready" class="controls">
      <button type="button" class="pager" @click="previous">{{ t('pager.previous') }}</button>
      <TocMenu
        v-if="toc.length > 0"
        :entries="toc"
        :current-href="currentHref"
        @select="onTocSelect"
      />
      <button type="button" class="pager" @click="next">{{ t('pager.next') }}</button>
    </div>
  </div>
</template>

<style scoped>
.epub-reader {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.epub-container {
  flex: 1;
  min-height: 0;
  border: 1px solid var(--hair-soft);
  border-radius: 3px;
  background: #fff;
  box-shadow: var(--shadow);
  transition: background 0.3s ease;
}
.epub-container.page-dark {
  background: #16171a;
}
/* A single page keeps a book's measure. Left to fill a laptop, one column
   runs past 110 characters a line — far outside the ~60-75 that reads
   comfortably, and worse than the two-column view it replaces. Narrowing the
   PANE (not the text inside it) is what epub.js paginates against, so the
   sheet itself becomes page-shaped and centred, like a real one. */
/* Scrolling: epub.js lays the whole chapter out at its true height inside a
   scroller of its own making, so this pane must NOT add a second one — two
   nested scrollbars trap a thumb between them. The momentum and the rubber
   band belong to the inner scroller, which is why they are reached through it. */
.epub-container.scrolling {
  overflow: hidden;
}
.epub-container.scrolling :deep(> div) {
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}
.epub-container.one-up {
  width: min(100%, var(--page-measure));
  margin-inline: auto;
}
.controls > * {
  /* One height for everything on this row — the pagers, the contents, and the
     assistant's plate, which is drawn from another component and can only line
     up if they all measure from the same number. Fixed, not a minimum: a
     minimum lets a taller font push one control past the rest, which is
     exactly how the plate ended up standing proud of the row. */
  height: var(--pager-control-h);
}
.controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0;
}
/* The contents menu styles itself; see TocMenu.vue. */
.error {
  color: var(--danger);
}
/* Small screens: taps and swipes turn the pages; the buttons only cost room. */
@media (max-width: 640px) {
  .pager {
    display: none;
  }
  .controls {
    justify-content: center;
  }
}
</style>
