/** Export/import the whole library as a zip file (side effects live here). */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import { buildManifest, validateManifest, type BackupManifest } from '@/lib/backup'
import type { BookMeta } from '@/lib/types'
import {
  addAnnotation,
  addSpendRecord,
  getBookFile,
  listAnnotations,
  listBooks,
  listChatConversations,
  listReadingStats,
  listSpendRecords,
  putReadingStats,
  saveBook,
  saveChatConversation,
} from '@/services/db'

const MIME_BY_FORMAT = { pdf: 'application/pdf', epub: 'application/epub+zip' } as const

export async function exportLibrary(): Promise<Blob> {
  const [books, annotations, chats, spend, stats] = await Promise.all([
    listBooks(),
    listAnnotations(),
    listChatConversations(),
    listSpendRecords(),
    listReadingStats(),
  ])
  const manifest = buildManifest(books, annotations, chats, spend, stats, Date.now())

  const zippable: Zippable = {
    'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
  }
  for (const book of books) {
    const file = await getBookFile(book.id)
    if (!file) continue
    // Books are already compressed formats; store them uncompressed for speed.
    zippable[`files/${book.id}`] = [new Uint8Array(await file.arrayBuffer()), { level: 0 }]
    if (book.coverBlob) {
      zippable[`covers/${book.id}`] = [
        new Uint8Array(await book.coverBlob.arrayBuffer()),
        { level: 0 },
      ]
    }
  }
  const zipped = zipSync(zippable)
  return new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' })
}

export interface ImportSummary {
  books: number
  annotations: number
  chats: number
  spend: number
}

export async function importLibrary(file: File): Promise<ImportSummary> {
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
  const manifestBytes = entries['manifest.json']
  if (!manifestBytes) throw new Error('Not a Bookworm backup: manifest.json is missing.')
  const manifest: BackupManifest = validateManifest(JSON.parse(strFromU8(manifestBytes)))

  let importedBooks = 0
  for (const backupBook of manifest.books) {
    const fileBytes = entries[`files/${backupBook.id}`]
    if (!fileBytes) continue
    const { hasCover, ...meta } = backupBook
    const coverBytes = hasCover ? entries[`covers/${backupBook.id}`] : undefined
    const bookMeta: BookMeta = {
      ...meta,
      coverBlob: coverBytes
        ? new Blob([coverBytes.buffer as ArrayBuffer], { type: 'image/jpeg' })
        : null,
    }
    const blob = new Blob([fileBytes.buffer as ArrayBuffer], {
      type: MIME_BY_FORMAT[backupBook.format],
    })
    await saveBook(bookMeta, blob)
    importedBooks += 1
  }
  for (const annotation of manifest.annotations) await addAnnotation(annotation)
  for (const chat of manifest.chats) await saveChatConversation(chat)
  for (const record of manifest.spend) await addSpendRecord(record)
  for (const stats of manifest.stats) await putReadingStats(stats)

  return {
    books: importedBooks,
    annotations: manifest.annotations.length,
    chats: manifest.chats.length,
    spend: manifest.spend.length,
  }
}
