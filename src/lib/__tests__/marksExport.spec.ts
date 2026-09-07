import { describe, expect, it } from 'vitest'
import { buildMarksMarkdown, marksFilename, ENGLISH_MARKS } from '../marksExport'
import type { Annotation } from '@/lib/types'

const AT = Date.UTC(2026, 8, 6, 12)

function mark(partial: Partial<Annotation> & Pick<Annotation, 'type' | 'position'>): Annotation {
  return {
    id: `${partial.type}-${partial.position}`,
    bookId: 'b1',
    label: '',
    text: null,
    createdAt: 1,
    ...partial,
  }
}

const EPUB = { title: 'The Long Test Book', author: 'Len G. Fixture', format: 'epub' as const }

describe('marksFilename', () => {
  it('is the book, in a name a filesystem will take', () => {
    expect(marksFilename('The Long Test Book')).toBe('the-long-test-book-marks.md')
    expect(marksFilename('Moby-Dick; or, The Whale')).toBe('moby-dick-or-the-whale-marks.md')
  })

  it('keeps a title that is not written in Latin letters', () => {
    // Transliterating would be a guess; the alphabet is not what filesystems
    // object to.
    expect(marksFilename('雪国')).toBe('雪国-marks.md')
  })

  it('always has something to call the file', () => {
    expect(marksFilename('***')).toBe('book-marks.md')
    expect(marksFilename('')).toBe('book-marks.md')
  })
})

describe('buildMarksMarkdown', () => {
  const items = [
    mark({
      type: 'highlight',
      position: 'epubcfi(/6/4!/4/8)',
      label: 'the sheer volume',
      text: 'the sheer volume of words',
      createdAt: 3,
    }),
    mark({ type: 'bookmark', position: 'epubcfi(/6/2!/4/2)', label: 'Section 1', createdAt: 2 }),
    mark({
      type: 'note',
      position: 'epubcfi(/6/6!/4/2)',
      label: 'Page 12 of 40',
      text: 'The worm is the reader.',
      createdAt: 4,
    }),
  ]

  it('opens with the book and what is in the file', () => {
    const md = buildMarksMarkdown(EPUB, items, AT)
    expect(md.startsWith('# The Long Test Book')).toBe(true)
    expect(md).toContain('*Len G. Fixture*')
    expect(md).toContain('3 marks')
    expect(md).toMatch(/Saved from Bookworm on .*2026/)
  })

  it('runs in reading order, not the order they were made', () => {
    const md = buildMarksMarkdown(EPUB, items, AT)
    const order = ['Section 1', 'the sheer volume of words', 'The worm is the reader.'].map(
      (text) => md.indexOf(text),
    )
    expect(order.every((at) => at >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('says what each mark is, and quotes what it holds', () => {
    const md = buildMarksMarkdown(EPUB, items, AT)
    expect(md).toContain('**Bookmark** · Section 1')
    expect(md).toContain('> the sheer volume of words')
    expect(md).toContain('**Kept answer** · Page 12 of 40')
  })

  it('does not repeat a highlight’s opening words as its place', () => {
    const md = buildMarksMarkdown(EPUB, items, AT)
    expect(md).not.toContain('**Highlight** · the sheer volume')
    expect(md).toContain('**Highlight**\n')
  })

  it('numbers a PDF’s marks by page', () => {
    const pdf = { title: 'A PDF', author: null, format: 'pdf' as const }
    const md = buildMarksMarkdown(
      pdf,
      [mark({ type: 'highlight', position: '12', text: 'a line' })],
      AT,
    )
    expect(md).toContain('**Highlight** · Page 12')
  })

  it('will not let a passage become markup of its own', () => {
    const sneaky = mark({
      type: 'highlight',
      position: '1',
      text: '# Not a heading\n> not a quote',
    })
    const md = buildMarksMarkdown(EPUB, [sneaky], AT)
    expect(md).toContain('> \\# Not a heading')
    expect(md).toContain('> \\> not a quote')
    expect(md).not.toMatch(/^# Not a heading/m)
  })

  it('is a real file even when the reader marked nothing', () => {
    const md = buildMarksMarkdown(EPUB, [], AT)
    expect(md).toContain('# The Long Test Book')
    expect(md).toContain('0 marks')
    expect(md).toContain('Nothing was marked')
  })

  it('counts in one and takes its words from outside', () => {
    const md = buildMarksMarkdown(EPUB, [items[1]!], AT)
    expect(md).toContain('1 mark ·')
    const spanish = buildMarksMarkdown(EPUB, [items[1]!], AT, 'es', {
      ...ENGLISH_MARKS,
      bookmark: 'Marcador',
      marks: { one: 'marca', other: 'marcas' },
      savedOn: 'Guardado desde Bookworm el {date}',
    })
    expect(spanish).toContain('1 marca')
    expect(spanish).toContain('**Marcador** · Section 1')
    expect(spanish).toContain('Guardado desde Bookworm el')
  })
})
