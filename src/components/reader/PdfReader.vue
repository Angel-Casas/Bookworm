<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { clampPage, parsePdfPosition } from '@/lib/position'
import { isTextEntryTarget } from '@/lib/keyboard'
import { DEFAULT_HIGHLIGHT_HEX, highlightWash, locateInSegments } from '@/lib/highlight'
import type { Annotation } from '@/lib/types'
import { useI18n } from '@/i18n'
import { loadPdfjs } from '@/services/pdfjs'
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'

const props = defineProps<{
  blob: Blob
  initialPosition: string | null
  highlights?: readonly Annotation[]
  pageTheme?: 'light' | 'dark'
}>()
const emit = defineEmits<{
  positionChange: [position: string]
  selection: [text: string, position: string, context: string]
  sectionChange: [index: number]
  highlightClick: [id: string, x: number, y: number]
  /** A plain tap/click on the page; fraction is 0..1 across the pane width. */
  pageTap: [fraction: number]
  swipe: [direction: 'left' | 'right']
  /** Page counter; a PDF's pages are real, so this is exact from the start. */
  pageMetrics: [current: number, total: number]
}>()

const { t } = useI18n()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const textLayerRef = ref<HTMLDivElement | null>(null)
const pageContainerRef = ref<HTMLDivElement | null>(null)
const currentPage = ref(1)
const pageCount = ref(0)
const error = ref<string | null>(null)

let loadingTask: PDFDocumentLoadingTask | null = null
let pdf: PDFDocumentProxy | null = null
let rendering = false

/** Re-render at the pane's new width when focus mode (or anything) resizes it. */
let resizeObserver: ResizeObserver | null = null
let resizeTimer = 0
let renderedWidth = 0

/** Immediate re-render at the pane's current width (announced resizes). */
function refit(): void {
  const width = pageContainerRef.value?.clientWidth ?? 0
  if (!pdf || width === 0 || Math.abs(width - renderedWidth) < 2) return
  void renderPage(currentPage.value).catch(() => {})
}

/** Fallback for resizes nobody announces (window drags, panel shifts). */
function watchPaneSize(): void {
  if (!pageContainerRef.value || typeof ResizeObserver === 'undefined') return
  resizeObserver = new ResizeObserver(() => {
    window.clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(refit, 140)
  })
  resizeObserver.observe(pageContainerRef.value)
}

async function renderPage(pageNumber: number): Promise<void> {
  if (!pdf || !canvasRef.value || !textLayerRef.value || !pageContainerRef.value || rendering)
    return
  rendering = true
  try {
    const pdfjs = await loadPdfjs()
    const page = await pdf.getPage(pageNumber)

    const containerWidth = pageContainerRef.value.clientWidth || 640
    renderedWidth = containerWidth
    const baseViewport = page.getViewport({ scale: 1 })
    const scale = containerWidth / baseViewport.width
    const viewport = page.getViewport({ scale })
    const outputScale = window.devicePixelRatio || 1

    const canvas = canvasRef.value
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D context unavailable')
    canvas.width = Math.floor(viewport.width * outputScale)
    canvas.height = Math.floor(viewport.height * outputScale)
    canvas.style.width = `${Math.floor(viewport.width)}px`
    canvas.style.height = `${Math.floor(viewport.height)}px`
    context.setTransform(outputScale, 0, 0, outputScale, 0, 0)

    await page.render({ canvas, canvasContext: context, viewport }).promise

    const textLayerDiv = textLayerRef.value
    textLayerDiv.replaceChildren()
    textLayerDiv.style.width = canvas.style.width
    textLayerDiv.style.height = canvas.style.height
    // This pdf.js build sizes/positions the layer via --total-scale-factor
    // (older docs say --scale-factor); set both so spans align with the canvas.
    textLayerDiv.style.setProperty('--scale-factor', String(scale))
    textLayerDiv.style.setProperty('--total-scale-factor', String(scale))
    const textLayer = new pdfjs.TextLayer({
      textContentSource: page.streamTextContent(),
      container: textLayerDiv,
      viewport,
    })
    await textLayer.render()

    currentPage.value = pageNumber
    paintHighlights()
    emit('positionChange', String(pageNumber))
    emit('pageMetrics', pageNumber, pageCount.value)
    emit('sectionChange', pageNumber - 1)
  } finally {
    rendering = false
  }
}

function goTo(pageNumber: number): void {
  const target = clampPage(pageNumber, pageCount.value)
  if (target !== currentPage.value) {
    void renderPage(target).catch((cause: unknown) => {
      error.value = cause instanceof Error ? cause.message : t('reader.pdfPageFailed')
    })
  }
}

function next(): void {
  goTo(currentPage.value + 1)
}

function previous(): void {
  goTo(currentPage.value - 1)
}

function onKeydown(event: KeyboardEvent): void {
  // Arrows inside inputs/textareas (chat composer, page-jump box, search)
  // move the caret, not the book.
  if (isTextEntryTarget(event.target)) return
  if (event.key === 'ArrowRight') next()
  else if (event.key === 'ArrowLeft') previous()
}

/**
 * The lines around a selection. A PDF text layer has no paragraphs — it is a
 * heap of positioned spans, roughly one per line — so the neighbourhood is
 * built by hand from the spans on either side. Enough for the sentence a word
 * sits in, which is all it is for.
 */
const CONTEXT_LINES = 3

function linesAround(selection: Selection | null): string {
  const node = selection?.anchorNode ?? null
  if (!node) return ''
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element)
  const span = element?.closest?.('.textLayer span') ?? null
  if (!span) return element?.textContent ?? ''
  const parts: string[] = [span.textContent ?? '']
  let before: Element | null = span.previousElementSibling
  for (let i = 0; i < CONTEXT_LINES && before; i++, before = before.previousElementSibling) {
    parts.unshift(before.textContent ?? '')
  }
  let after: Element | null = span.nextElementSibling
  for (let i = 0; i < CONTEXT_LINES && after; i++, after = after.nextElementSibling) {
    parts.push(after.textContent ?? '')
  }
  return parts.join(' ')
}

function onMouseUp(): void {
  const selection = window.getSelection()
  const text = selection?.toString() ?? ''
  if (text.trim().length === 0) return
  // No coordinates: the ink is in the toolbar, so nothing needs to be
  // positioned at the selection any more.
  emit('selection', text.trim(), String(currentPage.value), linesAround(selection))
}

/** Clicking a painted span opens the highlight editor at the cursor. */
function onLayerClick(event: MouseEvent): void {
  const span = (event.target as HTMLElement | null)?.closest<HTMLElement>('span[data-hl-id]')
  const id = span?.dataset.hlId
  if (id) emit('highlightClick', id, event.clientX, event.clientY)
}

let pointerDownX = 0
let pointerDownY = 0

function onPointerDown(event: MouseEvent): void {
  pointerDownX = event.clientX
  pointerDownY = event.clientY
}

/** Plain clicks on the page become tap-zone navigation (the view decides). */
function onContainerClick(event: MouseEvent): void {
  // A press that traveled is a selection drag, not a tap — the browser still
  // fires click on the common ancestor after a drag.
  if (Math.hypot(event.clientX - pointerDownX, event.clientY - pointerDownY) > 8) return
  // Highlight clicks are their own interaction, and a click that ends a text
  // selection is not a page tap.
  if ((event.target as HTMLElement | null)?.closest('span[data-hl-id]')) return
  if ((window.getSelection()?.toString() ?? '').trim().length > 0) return
  const container = pageContainerRef.value
  if (!container) return
  const rect = container.getBoundingClientRect()
  if (rect.width === 0) return
  emit('pageTap', Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1))
}

let touchStartX = 0
let touchStartY = 0

function onTouchStart(event: TouchEvent): void {
  const touch = event.changedTouches[0]
  if (!touch) return
  touchStartX = touch.clientX
  touchStartY = touch.clientY
}

function onTouchEnd(event: TouchEvent): void {
  const touch = event.changedTouches[0]
  if (!touch) return
  const dx = touch.clientX - touchStartX
  const dy = touch.clientY - touchStartY
  if (Math.abs(dx) > 55 && Math.abs(dy) < Math.abs(dx) * 0.6) {
    emit('swipe', dx < 0 ? 'left' : 'right')
  }
}

// Vue auto-applies the .number cast on type="number" inputs, so this ref can
// hold a number; normalize to string at the boundary before parsing.
const jumpInput = ref<string | number>('')

function onJump(): void {
  const target = parsePdfPosition(String(jumpInput.value))
  if (target !== null) goTo(target)
  jumpInput.value = ''
}

function goToPosition(position: string): void {
  const target = parsePdfPosition(position)
  if (target !== null) goTo(target)
}

/** Spans currently carrying a pastel wash, cleared before repainting. */
const paintedSpans: HTMLSpanElement[] = []

function paintHighlights(): void {
  for (const span of paintedSpans) {
    span.style.background = ''
    span.style.borderRadius = ''
    span.style.mixBlendMode = ''
    span.style.cursor = ''
    delete span.dataset.hlId
  }
  paintedSpans.length = 0
  const layer = textLayerRef.value
  if (!layer) return
  // The dark page is an inverted canvas; a normal wash would sit on it like
  // neon. Screen-blending a fainter wash lifts the glyphs gently instead.
  const dark = props.pageTheme === 'dark'
  const spans = Array.from(layer.querySelectorAll('span'))
  const texts = spans.map((span) => span.textContent ?? '')
  for (const item of props.highlights ?? []) {
    if (!item.text) continue
    if (parsePdfPosition(item.position) !== currentPage.value) continue
    const range = locateInSegments(texts, item.text)
    if (!range) continue
    const wash = highlightWash(item.color ?? DEFAULT_HIGHLIGHT_HEX, dark ? 0.34 : 0.55)
    for (let index = range.firstSegment; index <= range.lastSegment; index++) {
      const span = spans[index]
      if (!span) continue
      span.style.background = wash
      span.style.borderRadius = '2px'
      span.style.cursor = 'pointer'
      span.dataset.hlId = item.id
      if (dark) span.style.mixBlendMode = 'screen'
      paintedSpans.push(span)
    }
  }
}

watch(() => props.highlights, paintHighlights, { deep: true })
watch(() => props.pageTheme, paintHighlights)

const FLASH_MS = 2500

function flashTerm(term: string): void {
  const needle = term.toLowerCase()
  const spans = textLayerRef.value?.querySelectorAll('span') ?? []
  for (const span of spans) {
    if ((span.textContent ?? '').toLowerCase().includes(needle)) {
      span.classList.add('search-flash')
      span.scrollIntoView({ block: 'center' })
      setTimeout(() => span.classList.remove('search-flash'), FLASH_MS)
      return
    }
  }
}

/** Jump to the page at `position` and briefly flash the first hit of `term`. */
async function goToMatch(position: string, term: string): Promise<void> {
  const target = parsePdfPosition(position)
  if (target === null) return
  if (target !== currentPage.value) {
    await renderPage(clampPage(target, pageCount.value)).catch((cause: unknown) => {
      error.value = cause instanceof Error ? cause.message : t('reader.pdfPageFailed')
    })
  }
  flashTerm(term)
}

defineExpose({ goToPosition, goToMatch, next, previous, refit })

onMounted(async () => {
  try {
    const pdfjs = await loadPdfjs()
    loadingTask = pdfjs.getDocument({ data: await props.blob.arrayBuffer() })
    pdf = await loadingTask.promise
    pageCount.value = pdf.numPages
    const startPage = clampPage(parsePdfPosition(props.initialPosition) ?? 1, pdf.numPages)
    await renderPage(startPage)
    watchPaneSize()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('reader.pdfFailed')
  }
})

window.addEventListener('keydown', onKeydown)
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.clearTimeout(resizeTimer)
  resizeObserver?.disconnect()
  void loadingTask?.destroy()
})
</script>

<template>
  <div class="pdf-reader">
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div
      ref="pageContainerRef"
      class="page-container"
      :class="{ 'page-dark': pageTheme === 'dark' }"
      @mousedown="onPointerDown"
      @mouseup="onMouseUp"
      @click="onContainerClick"
      @touchstart.passive="onTouchStart"
      @touchend.passive="onTouchEnd"
    >
      <canvas ref="canvasRef"></canvas>
      <div
        ref="textLayerRef"
        class="textLayer"
        data-testid="pdf-text-layer"
        @click="onLayerClick"
      ></div>
    </div>
    <div v-if="pageCount > 0" class="controls">
      <button type="button" class="pager" :disabled="currentPage <= 1" @click="previous">
        {{ t('pager.previous') }}
      </button>
      <span class="page-info">
        {{ t('pager.pageOf', { current: currentPage, total: pageCount }) }}
        <input
          v-model="jumpInput"
          class="jump-input"
          type="number"
          min="1"
          :max="pageCount"
          :placeholder="t('pager.goTo')"
          :aria-label="t('pager.goToPage')"
          data-testid="page-jump"
          @keydown.enter.prevent="onJump"
        />
        <button type="button" data-testid="page-jump-go" @click="onJump">
          {{ t('pager.go') }}
        </button>
      </span>
      <button type="button" class="pager" :disabled="currentPage >= pageCount" @click="next">
        {{ t('pager.next') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.pdf-reader {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.page-container {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--hair-soft);
  border-radius: 3px;
  background: #fff;
  box-shadow: var(--shadow);
}
/* Night page: invert the rendered canvas (hue-rotate keeps images from going
   ghostly-cyan). The text layer is transparent glyphs, so it needs nothing. */
.page-container.page-dark {
  background: #16171a;
}
.page-container.page-dark canvas {
  filter: invert(0.93) hue-rotate(180deg);
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
  padding: 0.5rem 0;
}
.page-info {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.jump-input {
  width: 4.5rem;
}
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

/* pdf.js text layer, ported from pdf_viewer.css: invisible text positioned
   over the canvas so selection and highlight washes land on the right glyphs.
   The layer sizes itself via --total-scale-factor and --scale-round-x/y. */
.textLayer {
  position: absolute;
  inset: 0 auto auto 0;
  overflow: clip;
  line-height: 1;
  letter-spacing: normal;
  word-spacing: normal;
  text-size-adjust: none;
  forced-color-adjust: none;
  transform-origin: 0 0;
  z-index: 0;
  --min-font-size: 1;
  --scale-round-x: 1px;
  --scale-round-y: 1px;
  --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
  --min-font-size-inv: calc(1 / var(--min-font-size));
}
.textLayer :deep(span),
.textLayer :deep(br) {
  color: transparent;
  position: absolute;
  white-space: pre;
  cursor: text;
  transform-origin: 0% 0%;
  user-select: text;
}
.textLayer :deep(span:not(.markedContent)) {
  z-index: 1;
  --font-height: 0;
  font-size: calc(var(--text-scale-factor) * var(--font-height));
  --scale-x: 1;
  --rotate: 0deg;
  transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
}
.textLayer :deep(span.markedContent) {
  display: contents;
}
.textLayer :deep(span)::selection {
  background: rgba(0, 100, 255, 0.35);
}
.textLayer :deep(span.search-flash) {
  background: rgba(240, 174, 47, 0.55);
  transition: background 0.6s ease;
  border-radius: 2px;
}
</style>
