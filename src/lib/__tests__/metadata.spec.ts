import { describe, expect, it } from 'vitest'
import {
  formatBytes,
  inferFormat,
  normalizeAuthor,
  normalizeTitle,
  titleFromFileName,
} from '../metadata'

describe('inferFormat', () => {
  it('prefers MIME type over extension', () => {
    expect(inferFormat('weird.bin', 'application/epub+zip')).toBe('epub')
    expect(inferFormat('doc.txt', 'application/pdf')).toBe('pdf')
  })
  it('falls back to the file extension, case-insensitively', () => {
    expect(inferFormat('Book.EPUB', '')).toBe('epub')
    expect(inferFormat('paper.pdf', 'application/octet-stream')).toBe('pdf')
  })
  it('returns null for unsupported files', () => {
    expect(inferFormat('notes.txt', 'text/plain')).toBeNull()
    expect(inferFormat('archive', '')).toBeNull()
  })
})

describe('titleFromFileName', () => {
  it('strips the extension and prettifies separators', () => {
    expect(titleFromFileName('the_great-gatsby.epub')).toBe('the great gatsby')
    expect(titleFromFileName('My  Book.pdf')).toBe('My Book')
  })
  it('keeps the original name when stripping would leave nothing', () => {
    expect(titleFromFileName('.epub')).toBe('.epub')
  })
})

describe('normalizeAuthor', () => {
  it('trims strings and rejects empties and non-strings', () => {
    expect(normalizeAuthor('  Jane Austen ')).toBe('Jane Austen')
    expect(normalizeAuthor('   ')).toBeNull()
    expect(normalizeAuthor(42)).toBeNull()
    expect(normalizeAuthor(undefined)).toBeNull()
  })
})

describe('normalizeTitle', () => {
  it('uses the metadata title when present', () => {
    expect(normalizeTitle(' Dune ', 'dune.epub')).toBe('Dune')
  })
  it('falls back to the file name otherwise', () => {
    expect(normalizeTitle(undefined, 'dune_messiah.epub')).toBe('dune messiah')
  })
})

describe('formatBytes', () => {
  it('formats across unit boundaries', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })
  it('handles invalid input defensively', () => {
    expect(formatBytes(-1)).toBe('—')
    expect(formatBytes(Number.NaN)).toBe('—')
  })
})
