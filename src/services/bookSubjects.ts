/**
 * What a book's own file says it is about — read only when asked.
 *
 * EPUBs carry `dc:subject` in their package document; PDFs carry Subject and
 * Keywords in their info dictionary. Neither is read at import (it would slow
 * every import for a suggestion most readers never look at), so this opens the
 * file when the shelf picker asks, and answers with raw strings for
 * `topicSuggestions` to tidy.
 *
 * Every failure is an empty answer: a suggestion that cannot be made is simply
 * not offered.
 */
import { strFromU8, unzipSync } from 'fflate'
import { loadPdfjs } from '@/services/pdfjs'
import type { BookFormat } from '@/lib/types'

export async function readBookSubjects(blob: Blob, format: BookFormat): Promise<string[]> {
  try {
    return format === 'epub' ? await epubSubjects(blob) : await pdfSubjects(blob)
  } catch {
    return []
  }
}

async function epubSubjects(blob: Blob): Promise<string[]> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const container = unzipSync(bytes, { filter: (file) => file.name === 'META-INF/container.xml' })
  const containerXml = container['META-INF/container.xml']
  if (!containerXml) return []
  const parser = new DOMParser()
  const rootfile = parser
    .parseFromString(strFromU8(containerXml), 'application/xml')
    .getElementsByTagNameNS('*', 'rootfile')[0]
    ?.getAttribute('full-path')
  if (!rootfile) return []
  const opf = unzipSync(bytes, { filter: (file) => file.name === rootfile })[rootfile]
  if (!opf) return []
  const doc = parser.parseFromString(strFromU8(opf), 'application/xml')
  return Array.from(doc.getElementsByTagNameNS('*', 'subject'))
    .map((node) => node.textContent ?? '')
    .filter((text) => text.trim().length > 0)
}

async function pdfSubjects(blob: Blob): Promise<string[]> {
  const pdfjs = await loadPdfjs()
  const task = pdfjs.getDocument({ data: await blob.arrayBuffer() })
  try {
    const pdf = await task.promise
    const metadata = await pdf.getMetadata().catch(() => null)
    const info = (metadata?.info ?? {}) as Record<string, unknown>
    return [info['Subject'], info['Keywords']].filter(
      (value): value is string => typeof value === 'string' && value.trim().length > 0,
    )
  } finally {
    await task.destroy()
  }
}
