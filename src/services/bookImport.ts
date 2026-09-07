/**
 * Turns a user-selected File into an ImportedBook (metadata + blob).
 * Parsing libraries are imported lazily so the library shelf loads fast.
 */
import { generateId } from '@/lib/id'
import { inferFormat, normalizeAuthor, normalizeTitle } from '@/lib/metadata'
import { loadPdfjs } from '@/services/pdfjs'
import type { BookFormat, BookMeta, ImportedBook } from '@/lib/types'

export class UnsupportedFileError extends Error {
  constructor(fileName: string) {
    super(`Unsupported file type: ${fileName}. Only PDF and EPUB are supported.`)
    this.name = 'UnsupportedFileError'
  }
}

/** Bump when cover extraction improves, so the backfill retries old books. */
export const COVER_EXTRACT_VERSION = 2

const COVER_TARGET_WIDTH = 320
/** Manifest images smaller than this are icons/ornaments, not covers. */
const MIN_COVER_BYTES = 4096

export async function importBookFile(file: File): Promise<ImportedBook> {
  const format = inferFormat(file.name, file.type)
  if (format === null) throw new UnsupportedFileError(file.name)

  const parsed = format === 'epub' ? await parseEpub(file) : await parsePdf(file)

  const meta: BookMeta = {
    id: generateId(),
    title: normalizeTitle(parsed.title, file.name),
    author: normalizeAuthor(parsed.author),
    format,
    fileName: file.name,
    fileSize: file.size,
    addedAt: Date.now(),
    lastOpenedAt: null,
    coverBlob: parsed.cover,
    coverChecked: COVER_EXTRACT_VERSION,
    position: null,
  }
  return { meta, blob: file }
}

/**
 * Cover-only extraction, used to backfill books imported before the
 * fallback hunt existed. Never throws.
 */
export async function extractCover(blob: Blob, format: BookFormat): Promise<Blob | null> {
  try {
    if (format === 'pdf') {
      const parsed = await parsePdf(blob)
      return parsed.cover
    }
    const parsed = await parseEpub(blob)
    return parsed.cover
  } catch (error) {
    console.warn('[bookworm] cover extraction failed:', error)
    return null
  }
}

interface ParsedDetails {
  title: unknown
  author: unknown
  cover: Blob | null
}

/** The slices of epub.js we touch for cover hunting (its own types are loose). */
interface EpubManifestItem {
  href?: string
  type?: string
}
interface EpubBookInternals {
  packaging?: { manifest?: Record<string, EpubManifestItem> }
  archive?: { createUrl?: (url: string, options: { base64: boolean }) => Promise<string> }
  resolve?: (path: string) => string
}

async function parseEpub(file: Blob): Promise<ParsedDetails> {
  const { default: ePub } = await import('epubjs')
  const book = ePub(await file.arrayBuffer())
  try {
    await book.ready
    const metadata = await book.loaded.metadata
    let cover: Blob | null = null
    const coverUrl = await book.coverUrl().catch(() => null)
    if (coverUrl) {
      cover = await fetch(coverUrl)
        .then((response) => response.blob())
        .catch(() => null)
    }
    // Many real EPUBs never declare their cover in metadata; hunt the
    // manifest for a likely image before giving up.
    if (!cover) cover = await huntManifestCover(book as unknown as EpubBookInternals)
    return { title: metadata?.title, author: metadata?.creator, cover }
  } finally {
    book.destroy()
  }
}

async function huntManifestCover(book: EpubBookInternals): Promise<Blob | null> {
  try {
    const manifest = book.packaging?.manifest ?? {}
    const images = Object.entries(manifest).filter(([, item]) =>
      (item.type ?? '').startsWith('image/'),
    )
    if (images.length === 0) return null
    const named = images.filter(([id, item]) =>
      /cover|frontispiece|titlepage|portada/i.test(`${id} ${item.href ?? ''}`),
    )
    const candidates = (named.length > 0 ? named : images).slice(0, 6)
    let best: Blob | null = null
    for (const [, item] of candidates) {
      if (!item.href || !book.archive?.createUrl || !book.resolve) continue
      const resolved = book.resolve(item.href)
      const url = await book.archive.createUrl(resolved, { base64: false }).catch(() => null)
      if (!url) continue
      const blob = await fetch(url)
        .then((response) => response.blob())
        .catch(() => null)
      if (blob && blob.size >= MIN_COVER_BYTES && (best === null || blob.size > best.size)) {
        best = blob
      }
    }
    return best
  } catch {
    return null
  }
}

async function parsePdf(file: Blob): Promise<ParsedDetails> {
  const pdfjs = await loadPdfjs()
  const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() })
  const pdf = await loadingTask.promise
  try {
    const metadata = await pdf.getMetadata().catch(() => null)
    const info = (metadata?.info ?? {}) as Record<string, unknown>
    const cover = await renderFirstPageThumbnail(pdf).catch(() => null)
    return { title: info['Title'], author: info['Author'], cover }
  } finally {
    await loadingTask.destroy()
  }
}

async function renderFirstPageThumbnail(
  pdf: import('pdfjs-dist').PDFDocumentProxy,
): Promise<Blob | null> {
  const page = await pdf.getPage(1)
  const baseViewport = page.getViewport({ scale: 1 })
  const scale = COVER_TARGET_WIDTH / baseViewport.width
  const viewport = page.getViewport({ scale })

  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const context = canvas.getContext('2d')
  if (!context) return null

  await page.render({ canvas, canvasContext: context, viewport }).promise
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.8)
  })
}
