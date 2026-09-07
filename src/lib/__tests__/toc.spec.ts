import { describe, expect, it } from 'vitest'
import { currentTocIndex, flattenToc, TOC_MAX_DEPTH, tocPath } from '../toc'

describe('flattenToc', () => {
  it('flattens the tree and remembers how deep each entry was', () => {
    const entries = flattenToc([
      { label: 'Chapter 1', href: 'ch1.xhtml', subitems: [{ label: 'A part', href: 'ch1.xhtml#a' }] },
      { label: 'Chapter 2', href: 'ch2.xhtml' },
    ])
    expect(entries).toEqual([
      { label: 'Chapter 1', href: 'ch1.xhtml', depth: 0 },
      { label: 'A part', href: 'ch1.xhtml#a', depth: 1 },
      { label: 'Chapter 2', href: 'ch2.xhtml', depth: 0 },
    ])
  })

  it('trims the labels publishers pad', () => {
    expect(flattenToc([{ label: '  Chapter 1  ', href: 'ch1.xhtml' }])[0]?.label).toBe('Chapter 1')
  })

  it('keeps the children of a grouping node that has no link of its own', () => {
    const entries = flattenToc([
      { label: 'Part One', subitems: [{ label: 'Chapter 1', href: 'ch1.xhtml' }] },
    ])
    // The empty node is skipped, but it does not take its chapter with it —
    // and the chapter keeps the depth the publisher gave it.
    expect(entries).toEqual([{ label: 'Chapter 1', href: 'ch1.xhtml', depth: 1 }])
  })

  it('ignores entries with nothing to show or nowhere to go', () => {
    expect(flattenToc([{ label: 'Nowhere' }, { href: 'x.xhtml' }, null, 'nonsense'])).toEqual([])
  })

  it('stops counting depth past the level the menu can show', () => {
    let node: unknown = { label: 'Deep', href: 'd.xhtml' }
    for (let i = 0; i < 6; i++) node = { label: `L${i}`, href: `l${i}.xhtml`, subitems: [node] }
    const flat = flattenToc([node])
    expect(flat[flat.length - 1]?.depth).toBe(TOC_MAX_DEPTH)
  })
})

describe('tocPath', () => {
  it('reduces an href to the file it points at', () => {
    expect(tocPath('./Text/ch02.xhtml#part3')).toBe('text/ch02.xhtml')
    expect(tocPath('/OEBPS/ch2.xhtml')).toBe('oebps/ch2.xhtml')
    expect(tocPath('ch2.xhtml')).toBe('ch2.xhtml')
  })
})

describe('currentTocIndex', () => {
  const entries = flattenToc([
    { label: 'Cover', href: 'cover.xhtml' },
    { label: 'Chapter 1', href: 'ch1.xhtml', subitems: [{ label: 'A part', href: 'ch1.xhtml#a' }] },
    { label: 'Chapter 2', href: './ch2.xhtml' },
  ])

  it('takes an exact match', () => {
    expect(currentTocIndex(entries, 'ch1.xhtml#a')).toBe(2)
  })

  it('otherwise takes the chapter that file opens with', () => {
    // epub.js reports the section href without the fragment the contents used.
    expect(currentTocIndex(entries, 'ch1.xhtml')).toBe(1)
    expect(currentTocIndex(entries, 'OEBPS/../ch2.xhtml'.replace('OEBPS/../', ''))).toBe(3)
  })

  it('shrugs off the ways an href can be written', () => {
    expect(currentTocIndex(entries, './ch1.xhtml')).toBe(1)
    expect(currentTocIndex(entries, 'CH1.xhtml')).toBe(1)
  })

  it('says nothing rather than guessing when the page is in no chapter', () => {
    expect(currentTocIndex(entries, 'copyright.xhtml')).toBe(-1)
    expect(currentTocIndex(entries, null)).toBe(-1)
    expect(currentTocIndex(entries, '')).toBe(-1)
  })
})
