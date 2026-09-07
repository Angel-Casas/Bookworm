/**
 * Pure backup-manifest construction and validation. Structural types are
 * defined here (not imported from services) to keep this module dependency-free.
 */
import type { Annotation, BookMeta } from './types'

export const BACKUP_VERSION = 1 as const

export type BackupBook = Omit<BookMeta, 'coverBlob'> & { hasCover: boolean }

export interface BackupChat {
  bookId: string
  messages: Array<{ role: 'user' | 'assistant'; content: string; referenceLabels?: string[] }>
  updatedAt: number
}

export interface BackupSpend {
  id: string
  bookId: string
  modelId: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costUsd: number | null
  at: number
}

export interface BackupStats {
  bookId: string
  readingSeconds: number
  pageTurns: number
  firstReadAt: number | null
  lastReadAt: number | null
}

export interface BackupManifest {
  version: typeof BACKUP_VERSION
  exportedAt: number
  books: BackupBook[]
  annotations: Annotation[]
  chats: BackupChat[]
  spend: BackupSpend[]
  stats: BackupStats[]
}

export function buildManifest(
  books: BookMeta[],
  annotations: Annotation[],
  chats: BackupChat[],
  spend: BackupSpend[],
  stats: BackupStats[],
  exportedAt: number,
): BackupManifest {
  return {
    version: BACKUP_VERSION,
    exportedAt,
    books: books.map((book) => {
      const { coverBlob, ...rest } = book
      return { ...rest, hasCover: coverBlob !== null }
    }),
    annotations,
    chats,
    spend,
    stats,
  }
}

export class InvalidBackupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidBackupError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Validate untrusted manifest data from an imported file. */
export function validateManifest(data: unknown): BackupManifest {
  if (!isRecord(data)) throw new InvalidBackupError('Backup manifest is not an object.')
  if (data.version !== BACKUP_VERSION) {
    throw new InvalidBackupError(`Unsupported backup version: ${String(data.version)}.`)
  }
  if (!Array.isArray(data.books)) throw new InvalidBackupError('Backup has no book list.')
  for (const book of data.books) {
    if (!isRecord(book) || typeof book.id !== 'string' || typeof book.title !== 'string') {
      throw new InvalidBackupError('Backup contains an invalid book entry.')
    }
    if (book.format !== 'pdf' && book.format !== 'epub') {
      throw new InvalidBackupError(`Unknown book format: ${String(book.format)}.`)
    }
  }
  const annotations = Array.isArray(data.annotations) ? data.annotations : []
  const chats = Array.isArray(data.chats) ? data.chats : []
  const spend = Array.isArray(data.spend) ? data.spend : []
  const stats = Array.isArray(data.stats) ? data.stats : []
  return {
    version: BACKUP_VERSION,
    exportedAt: typeof data.exportedAt === 'number' ? data.exportedAt : 0,
    books: data.books as BackupBook[],
    annotations: annotations.filter(
      (entry): entry is Annotation =>
        isRecord(entry) && typeof entry.id === 'string' && typeof entry.bookId === 'string',
    ),
    chats: chats.filter(
      (entry): entry is BackupChat =>
        isRecord(entry) && typeof entry.bookId === 'string' && Array.isArray(entry.messages),
    ),
    spend: spend.filter(
      (entry): entry is BackupSpend =>
        isRecord(entry) && typeof entry.id === 'string' && typeof entry.bookId === 'string',
    ),
    stats: stats.filter(
      (entry): entry is BackupStats =>
        isRecord(entry) &&
        typeof entry.bookId === 'string' &&
        typeof entry.readingSeconds === 'number',
    ),
  }
}
