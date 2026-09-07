import { describe, expect, it } from 'vitest'
import { BACKUP_VERSION, buildManifest, validateManifest } from '../backup'
import type { BookMeta } from '../types'

const book: BookMeta = {
  id: 'b1',
  title: 'Dune',
  author: 'Frank Herbert',
  format: 'epub',
  fileName: 'dune.epub',
  fileSize: 100,
  addedAt: 1,
  lastOpenedAt: null,
  coverBlob: null,
  position: 'epubcfi(/6/4)',
}

describe('buildManifest', () => {
  it('strips cover blobs and records their presence', () => {
    const manifest = buildManifest([book], [], [], [], [], 42)
    expect(manifest.version).toBe(BACKUP_VERSION)
    expect(manifest.exportedAt).toBe(42)
    expect(manifest.books[0]).not.toHaveProperty('coverBlob')
    expect(manifest.books[0]!.hasCover).toBe(false)
    expect(manifest.books[0]!.position).toBe('epubcfi(/6/4)')
  })
})

describe('validateManifest', () => {
  it('round-trips a built manifest', () => {
    const manifest = buildManifest([book], [], [], [], [], 42)
    const parsed = validateManifest(JSON.parse(JSON.stringify(manifest)))
    expect(parsed.books).toHaveLength(1)
  })
  it('rejects garbage', () => {
    expect(() => validateManifest(null)).toThrow('not an object')
    expect(() => validateManifest({ version: 99 })).toThrow('Unsupported backup version')
    expect(() => validateManifest({ version: 1 })).toThrow('no book list')
    expect(() => validateManifest({ version: 1, books: [{ id: 1 }] })).toThrow('invalid book entry')
    expect(() =>
      validateManifest({ version: 1, books: [{ id: 'x', title: 't', format: 'docx' }] }),
    ).toThrow('Unknown book format')
  })
  it('drops malformed optional entries instead of failing', () => {
    const parsed = validateManifest({
      version: 1,
      books: [],
      annotations: [{ nonsense: true }],
      chats: [{ bookId: 'b', messages: [] }, 'junk'],
      spend: [],
      stats: [
        { bookId: 'b', readingSeconds: 60, pageTurns: 3, firstReadAt: 1, lastReadAt: 2 },
        { bad: 1 },
      ],
    })
    expect(parsed.annotations).toHaveLength(0)
    expect(parsed.chats).toHaveLength(1)
    expect(parsed.stats).toHaveLength(1)
  })
})
