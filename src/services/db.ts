/**
 * IndexedDB persistence layer (side effects live here).
 * Two stores: `books` (small metadata for fast shelf rendering) and
 * `files` (large blobs, loaded only when a book is opened). See ADR-006.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Annotation, BookMeta } from '@/lib/types'

export interface StoredChatMessage {
  role: 'user' | 'assistant'
  content: string
  referenceLabels?: string[]
}

export interface ChatConversation {
  bookId: string
  messages: StoredChatMessage[]
  updatedAt: number
}

export interface ReadingStats {
  bookId: string
  readingSeconds: number
  pageTurns: number
  firstReadAt: number | null
  lastReadAt: number | null
}

/**
 * A book's synthetic pagination, cached so reopening is instant. EPUBs have no
 * pages of their own: epub.js derives them by walking every section's text,
 * which costs seconds on a long book and would otherwise be paid on every open.
 * Kept out of `books` so the shelf listing stays small.
 */
export interface BookLocations {
  bookId: string
  /** epub.js `locations.save()` output. */
  json: string
  /** Characters per synthetic page, so a changed setting invalidates the cache. */
  chars: number
}

export interface SpendRecord {
  id: string
  bookId: string
  modelId: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /** USD; null when the model's pricing was unknown at request time. */
  costUsd: number | null
  at: number
}

interface BookwormSchema extends DBSchema {
  books: { key: string; value: BookMeta }
  files: { key: string; value: { bookId: string; blob: Blob } }
  spend: { key: string; value: SpendRecord; indexes: { 'by-book': string } }
  chats: { key: string; value: ChatConversation }
  annotations: { key: string; value: Annotation; indexes: { 'by-book': string } }
  stats: { key: string; value: ReadingStats }
  locations: { key: string; value: BookLocations }
}

const DB_NAME = 'bookworm'
const DB_VERSION = 5

let dbPromise: Promise<IDBPDatabase<BookwormSchema>> | null = null

function applySchema(db: IDBPDatabase<BookwormSchema>): void {
  if (!db.objectStoreNames.contains('books')) {
    db.createObjectStore('books', { keyPath: 'id' })
  }
  if (!db.objectStoreNames.contains('files')) {
    db.createObjectStore('files', { keyPath: 'bookId' })
  }
  if (!db.objectStoreNames.contains('spend')) {
    const spendStore = db.createObjectStore('spend', { keyPath: 'id' })
    spendStore.createIndex('by-book', 'bookId')
  }
  if (!db.objectStoreNames.contains('chats')) {
    db.createObjectStore('chats', { keyPath: 'bookId' })
  }
  if (!db.objectStoreNames.contains('annotations')) {
    const annotationStore = db.createObjectStore('annotations', { keyPath: 'id' })
    annotationStore.createIndex('by-book', 'bookId')
  }
  if (!db.objectStoreNames.contains('locations')) {
    db.createObjectStore('locations', { keyPath: 'bookId' })
  }
  if (!db.objectStoreNames.contains('stats')) {
    db.createObjectStore('stats', { keyPath: 'bookId' })
  }
}

const REQUIRED_STORES = [
  'books',
  'files',
  'spend',
  'chats',
  'annotations',
  'stats',
  'locations',
] as const

function isVersionError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'VersionError'
}

/**
 * Open the database, tolerating a pre-existing 'bookworm' DB at a higher
 * version. Dev servers share the localhost origin, so another project (or an
 * older prototype) may have left such a DB behind. In that case we adopt the
 * existing version and, if our stores are missing, create them via a bump.
 */
async function openBookwormDB(): Promise<IDBPDatabase<BookwormSchema>> {
  try {
    return await openDB<BookwormSchema>(DB_NAME, DB_VERSION, { upgrade: applySchema })
  } catch (error) {
    if (!isVersionError(error)) throw error
    const existing = await openDB<BookwormSchema>(DB_NAME)
    const hasAllStores = REQUIRED_STORES.every((name) => existing.objectStoreNames.contains(name))
    if (hasAllStores) return existing
    const nextVersion = existing.version + 1
    existing.close()
    return openDB<BookwormSchema>(DB_NAME, nextVersion, { upgrade: applySchema })
  }
}

function getDB(): Promise<IDBPDatabase<BookwormSchema>> {
  dbPromise ??= openBookwormDB().catch((error: unknown) => {
    dbPromise = null
    throw error
  })
  return dbPromise
}

export async function listBooks(): Promise<BookMeta[]> {
  const db = await getDB()
  return db.getAll('books')
}

export async function saveBook(meta: BookMeta, blob: Blob): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['books', 'files'], 'readwrite')
  await Promise.all([
    tx.objectStore('books').put(meta),
    tx.objectStore('files').put({ bookId: meta.id, blob }),
    tx.done,
  ])
}

export async function updateBookMeta(meta: BookMeta): Promise<void> {
  const db = await getDB()
  await db.put('books', meta)
}

export async function getBookMeta(id: string): Promise<BookMeta | undefined> {
  const db = await getDB()
  return db.get('books', id)
}

export async function getBookFile(id: string): Promise<Blob | undefined> {
  const db = await getDB()
  const record = await db.get('files', id)
  return record?.blob
}

export async function deleteBook(id: string): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(
    ['books', 'files', 'chats', 'annotations', 'stats', 'locations'],
    'readwrite',
  )
  const annotationIndex = tx.objectStore('annotations').index('by-book')
  const annotationIds = await annotationIndex.getAllKeys(id)
  await Promise.all([
    tx.objectStore('books').delete(id),
    tx.objectStore('files').delete(id),
    tx.objectStore('chats').delete(id),
    tx.objectStore('stats').delete(id),
    tx.objectStore('locations').delete(id),
    ...annotationIds.map((key) => tx.objectStore('annotations').delete(key)),
    tx.done,
  ])
  // Spend records are intentionally kept (ADR-012).
}

/** Cached pagination for a book, if it was generated under the same setting. */
export async function getBookLocations(
  bookId: string,
  chars: number,
): Promise<string | undefined> {
  const db = await getDB()
  const record = await db.get('locations', bookId)
  return record?.chars === chars ? record.json : undefined
}

export async function saveBookLocations(record: BookLocations): Promise<void> {
  const db = await getDB()
  await db.put('locations', record)
}

export async function addSpendRecord(record: SpendRecord): Promise<void> {
  const db = await getDB()
  await db.put('spend', record)
}

export async function listSpendRecords(): Promise<SpendRecord[]> {
  const db = await getDB()
  return db.getAll('spend')
}

export async function listSpendForBook(bookId: string): Promise<SpendRecord[]> {
  const db = await getDB()
  return db.getAllFromIndex('spend', 'by-book', bookId)
}

export async function getChatConversation(bookId: string): Promise<ChatConversation | undefined> {
  const db = await getDB()
  return db.get('chats', bookId)
}

export async function saveChatConversation(conversation: ChatConversation): Promise<void> {
  const db = await getDB()
  await db.put('chats', conversation)
}

export async function listChatConversations(): Promise<ChatConversation[]> {
  const db = await getDB()
  return db.getAll('chats')
}

export async function addAnnotation(annotation: Annotation): Promise<void> {
  const db = await getDB()
  await db.put('annotations', annotation)
}

export async function listAnnotationsForBook(bookId: string): Promise<Annotation[]> {
  const db = await getDB()
  return db.getAllFromIndex('annotations', 'by-book', bookId)
}

export async function listAnnotations(): Promise<Annotation[]> {
  const db = await getDB()
  return db.getAll('annotations')
}

export async function deleteAnnotation(id: string): Promise<void> {
  const db = await getDB()
  await db.delete('annotations', id)
}

export async function getReadingStats(bookId: string): Promise<ReadingStats | undefined> {
  const db = await getDB()
  return db.get('stats', bookId)
}

export async function putReadingStats(stats: ReadingStats): Promise<void> {
  const db = await getDB()
  await db.put('stats', stats)
}

export async function listReadingStats(): Promise<ReadingStats[]> {
  const db = await getDB()
  return db.getAll('stats')
}
