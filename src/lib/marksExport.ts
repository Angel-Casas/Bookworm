/**
 * A fair copy of what a reader marked.
 *
 * Marks live in IndexedDB, on one device, inside an app. That is right for
 * reading and wrong for everything after it: notes are worth having in a
 * notebook, a paper, a blog post, a message to whoever lent you the book. The
 * whole-library backup zip is not that — it is a machine's format, meant to be
 * read back by Bookworm and by nothing else.
 *
 * So: one markdown file per book, in reading order, with the place beside each
 * mark. Markdown because it is legible as it stands, opens in everything, and
 * is what every notes app already speaks.
 *
 * Pure. The download itself is three lines in the component that asks for it.
 */
import { sortAnnotationsByPosition } from '@/lib/annotationSort'
import { formatCount, plural, type Locale } from '@/lib/format'
import type { Annotation, BookFormat } from '@/lib/types'

/** The words the file is written in. Handed in, so a translator replaces
 *  strings rather than this layout. */
export interface MarksWords {
  bookmark: string
  highlight: string
  note: string
  /** e.g. { one: 'mark', other: 'marks' } */
  marks: { other: string } & Partial<Record<Intl.LDMLPluralRule, string>>
  /** "Saved from Bookworm on 6 September 2026" — `{date}` is replaced. */
  savedOn: string
  /** "Page 12" for a PDF mark — `{n}` is replaced. */
  page: string
  /** Shown when a book has been read but nothing was marked. */
  nothing: string
}

export const ENGLISH_MARKS: MarksWords = {
  bookmark: 'Bookmark',
  highlight: 'Highlight',
  note: 'Kept answer',
  marks: { one: 'mark', other: 'marks' },
  savedOn: 'Saved from Bookworm on {date}',
  page: 'Page {n}',
  nothing: 'Nothing was marked in this book.',
}

/**
 * A file name for this book's marks: the title, lowercased and hyphenated,
 * keeping its own letters. A Japanese or Arabic title should not come out as
 * `book-marks.md` — a name is only unusable if the filesystem says so, and
 * what filesystems object to is the punctuation, not the alphabet.
 */
export function marksFilename(title: string, suffix = 'marks'): string {
  const stem = title
    .normalize('NFC')
    .replace(/[\p{P}\p{S}\p{C}]/gu, ' ')
    .replace(/\s+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .toLowerCase()
    .slice(0, 60)
    .replace(/-+$/u, '')
  return `${stem.length > 0 ? stem : 'book'}-${suffix}.md`
}

/** Quote a passage without letting it become markup of its own. */
function blockquote(text: string): string {
  return text
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((line) => `> ${line.replace(/^(\s*)([#>])/u, '$1\\$2')}`)
    .join('\n')
}

export interface MarksBook {
  title: string
  author: string | null
  format: BookFormat
}

/**
 * The whole file. Marks come out in reading order, each headed by what it is
 * and where it is, because "Highlight · Page 212" is the two things a reader
 * needs to find their way back into the book.
 */
export function buildMarksMarkdown(
  book: MarksBook,
  annotations: readonly Annotation[],
  exportedAt: number,
  locale: Locale = 'en',
  words: MarksWords = ENGLISH_MARKS,
): string {
  const items = sortAnnotationsByPosition(annotations, book.format)
  const lines: string[] = [`# ${book.title}`, '']
  if (book.author) lines.push(`*${book.author}*`, '')

  let stamp = ''
  try {
    stamp = new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(exportedAt))
  } catch {
    stamp = new Date(exportedAt).toISOString().slice(0, 10)
  }
  const count = `${formatCount(items.length, locale)} ${plural(items.length, locale, words.marks)}`
  lines.push(`${count} · ${words.savedOn.replace('{date}', stamp)}`, '', '---', '')

  if (items.length === 0) {
    lines.push(words.nothing, '')
    return lines.join('\n')
  }

  const nameOf = (type: Annotation['type']): string =>
    type === 'bookmark' ? words.bookmark : type === 'note' ? words.note : words.highlight

  for (const item of items) {
    const place = placeOf(item, book.format, locale, words)
    lines.push(
      place.length > 0 ? `**${nameOf(item.type)}** · ${place}` : `**${nameOf(item.type)}**`,
    )
    lines.push('')
    if (item.text) {
      lines.push(blockquote(item.text.trim()), '')
    }
  }
  return lines.join('\n')
}

/**
 * Where a mark is, said plainly.
 *
 * A PDF stores a page number, which IS the answer. An EPUB stores a CFI, which
 * is not something to show anybody — for those the mark's own label is the
 * best there is, except for a highlight, whose label is its own opening words
 * and would only repeat the quotation printed underneath it.
 */
function placeOf(item: Annotation, format: BookFormat, locale: Locale, words: MarksWords): string {
  if (format === 'pdf') {
    const page = Number.parseInt(item.position, 10)
    if (Number.isFinite(page)) return words.page.replace('{n}', formatCount(page, locale))
  }
  return item.type === 'highlight' ? '' : item.label
}
