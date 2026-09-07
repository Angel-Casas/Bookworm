/**
 * Extracts plain text from books for LLM context, independent of the render
 * layer. Results are cached per book id (extraction is expensive).
 */
import { loadPdfjs } from '@/services/pdfjs'
import { sectionLabel } from '@/lib/sectionLabel'
import type { BookFormat } from '@/lib/types'

export interface SectionText {
  /** 0-based section index: spine position for EPUB, page number - 1 for PDF. */
  index: number
  /** Human label, e.g. "Section 3" or "Page 12". */
  label: string
  text: string
  /** Jump target for this section: EPUB spine href or PDF page number string. */
  position: string
}

const cache = new Map<string, Promise<SectionText[]>>()

export function getBookSections(
  bookId: string,
  format: BookFormat,
  blob: Blob,
): Promise<SectionText[]> {
  let promise = cache.get(bookId)
  if (!promise) {
    promise = (format === 'epub' ? extractEpubSections(blob) : extractPdfSections(blob)).catch(
      (error: unknown) => {
        cache.delete(bookId)
        throw error
      },
    )
    cache.set(bookId, promise)
  }
  return promise
}

export function evictBookSections(bookId: string): void {
  cache.delete(bookId)
}

interface SpineItemLike {
  href: string
  index: number
  load: (loader: unknown) => Promise<unknown>
  unload: () => void
}

async function extractEpubSections(blob: Blob): Promise<SectionText[]> {
  const { default: ePub } = await import('epubjs')
  const book = ePub(await blob.arrayBuffer())
  try {
    await book.ready
    const sections: SectionText[] = []
    const items: SpineItemLike[] = []
    book.spine.each((item: SpineItemLike) => {
      items.push(item)
    })
    for (const item of items) {
      const contents = (await item.load(book.load.bind(book))) as Document | Element
      const text = normalizeWhitespace(contents.textContent ?? '')
      // The chapter's own name, so a citation says where it points.
      const headings = [...contents.querySelectorAll('h1, h2, h3, title')].map(
        (heading) => heading.textContent ?? '',
      )
      item.unload()
      if (text.length > 0)
        sections.push({
          index: item.index,
          label: sectionLabel(headings, item.index),
          text,
          position: item.href,
        })
    }
    return sections
  } finally {
    book.destroy()
  }
}

async function extractPdfSections(blob: Blob): Promise<SectionText[]> {
  const pdfjs = await loadPdfjs()
  const loadingTask = pdfjs.getDocument({ data: await blob.arrayBuffer() })
  try {
    const pdf = await loadingTask.promise
    const sections: SectionText[] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      const text = normalizeWhitespace(
        content.items.map((item) => ('str' in item ? item.str : '')).join(' '),
      )
      if (text.length > 0)
        sections.push({
          index: pageNumber - 1,
          label: `Page ${pageNumber}`,
          text,
          position: String(pageNumber),
        })
    }
    return sections
  } finally {
    await loadingTask.destroy()
  }
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}
