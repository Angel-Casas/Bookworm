import { describe, expect, it } from 'vitest'
import { citationInstruction, parseCitations, type CitationSource } from '../citation'

const sources: CitationSource[] = [
  { label: 'Chapter 1', position: 'epubcfi(/6/2!/4/2/1:0)' },
  { label: 'Chapter 12', position: 'epubcfi(/6/24!/4/2/1:0)' },
  { label: 'Page 112', position: '112' },
]

const kinds = (parts: ReturnType<typeof parseCitations>) => parts.map((p) => `${p.kind}:${p.text}`)

describe('parseCitations', () => {
  it('turns a cited label into a citation carrying its position', () => {
    const parts = parseCitations('She leaves at dawn [Chapter 1].', sources)
    expect(kinds(parts)).toEqual(['text:She leaves at dawn ', 'citation:Chapter 1', 'text:.'])
    expect(parts[1]?.position).toBe('epubcfi(/6/2!/4/2/1:0)')
  })

  it('never matches a longer label as a shorter one', () => {
    const parts = parseCitations('Later [Chapter 12] it returns.', sources)
    expect(parts[1]?.text).toBe('Chapter 12')
    expect(parts[1]?.position).toBe('epubcfi(/6/24!/4/2/1:0)')
  })

  it('splits a multi-label bracket so each is separately pressable', () => {
    const parts = parseCitations('Both [Chapter 1, Page 112] agree.', sources)
    expect(kinds(parts)).toEqual([
      'text:Both ',
      'citation:Chapter 1',
      'citation:Page 112',
      'text: agree.',
    ])
  })

  it('leaves an invented label as plain text — we cannot open a page we never read', () => {
    const parts = parseCitations('As shown [Chapter 9].', sources)
    expect(kinds(parts)).toEqual(['text:As shown [Chapter 9].'])
  })

  it('leaves ordinary brackets alone', () => {
    const parts = parseCitations('an aside [see also] here', sources)
    expect(kinds(parts)).toEqual(['text:an aside [see also] here'])
  })

  it('matches a label regardless of the case the model used', () => {
    expect(parseCitations('yes [chapter 1]', sources)[1]?.text).toBe('Chapter 1')
  })

  it('handles several citations across one answer', () => {
    const parts = parseCitations('First [Chapter 1] then [Page 112] last.', sources)
    expect(parts.filter((p) => p.kind === 'citation')).toHaveLength(2)
  })

  it('is a no-op when nothing was sent to cite', () => {
    expect(kinds(parseCitations('Plain [Chapter 1] answer.', []))).toEqual([
      'text:Plain [Chapter 1] answer.',
    ])
  })

  it('returns nothing for an empty answer', () => {
    expect(parseCitations('', sources)).toEqual([])
  })
})

describe('citationInstruction', () => {
  it('names every available label so the model cites ours, not its own', () => {
    const instruction = citationInstruction(['Chapter 1', 'Page 112'])
    expect(instruction).toContain('[Chapter 1], [Page 112]')
    expect(instruction).toContain('never invent one')
  })

  it('says nothing when there is nothing to cite', () => {
    expect(citationInstruction([])).toBe('')
  })
})
