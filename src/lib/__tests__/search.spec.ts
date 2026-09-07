import { describe, expect, it } from 'vitest'
import { MAX_SEARCH_RESULTS, searchSections } from '../search'

const sections = [
  {
    index: 0,
    label: 'Page 1',
    position: '1',
    text: 'The worm ate the first page. A hungry worm indeed.',
  },
  { index: 1, label: 'Page 2', position: '2', text: 'Nothing to see here.' },
  { index: 2, label: 'Page 3', position: '3', text: 'The WORM returns for dessert.' },
]

describe('searchSections', () => {
  it('finds case-insensitive matches across sections with positions', () => {
    const results = searchSections(sections, 'worm')
    expect(results).toHaveLength(3)
    expect(results[0]!.position).toBe('1')
    expect(results[2]!.sectionLabel).toBe('Page 3')
  })
  it('builds excerpts around the match', () => {
    const results = searchSections(sections, 'dessert')
    expect(results[0]!.excerpt).toContain('returns for dessert')
  })
  it('reports the match offsets inside the excerpt', () => {
    const [result] = searchSections(sections, 'DESSERT')
    const marked = result!.excerpt.slice(result!.matchStart, result!.matchEnd)
    expect(marked.toLowerCase()).toBe('dessert')
  })
  it('offsets stay correct when the excerpt is truncated with ellipses', () => {
    const long = [
      {
        index: 0,
        label: 'P',
        position: '1',
        text: 'x'.repeat(200) + ' target word here ' + 'y'.repeat(200),
      },
    ]
    const [result] = searchSections(long, 'target')
    expect(result!.excerpt.startsWith('…')).toBe(true)
    expect(result!.excerpt.slice(result!.matchStart, result!.matchEnd)).toBe('target')
  })
  it('ignores blank and single-character queries', () => {
    expect(searchSections(sections, ' ')).toHaveLength(0)
    expect(searchSections(sections, 'a')).toHaveLength(0)
  })
  it('caps the number of results', () => {
    const big = [{ index: 0, label: 'P', position: '1', text: 'zap '.repeat(500) }]
    expect(searchSections(big, 'zap')).toHaveLength(MAX_SEARCH_RESULTS)
  })
})
