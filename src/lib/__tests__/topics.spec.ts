import { describe, expect, it } from 'vitest'
import {
  allTopics,
  groupByTopic,
  hasTopic,
  normalizeTopic,
  renameInOrder,
  renamedTopic,
  topicSuggestions,
  uniqueTopics,
  withTopic,
  withoutTopic,
} from '../topics'

const book = (id: string, topics?: string[]) => ({ id, topics })

describe('normalizeTopic', () => {
  it('tidies spaces and refuses blanks', () => {
    expect(normalizeTopic('  Sea   stories ')).toBe('Sea stories')
    expect(normalizeTopic('   ')).toBeNull()
  })
  it('caps the length', () => {
    expect(normalizeTopic('x'.repeat(80))?.length).toBe(40)
  })
})

describe('matching names', () => {
  it('ignores case and spacing', () => {
    expect(hasTopic(book('a', ['Gothic']), ' gothic ')).toBe(true)
    expect(hasTopic(book('a'), 'Gothic')).toBe(false)
  })
  it('keeps the first spelling of a duplicate', () => {
    expect(uniqueTopics(['Fiction', 'fiction', ' ', 'Gothic'])).toEqual(['Fiction', 'Gothic'])
  })
})

describe('allTopics', () => {
  it('keeps the reader order, then adds unknown topics alphabetically', () => {
    const books = [book('a', ['Zoology', 'Fiction']), book('b', ['Art'])]
    expect(allTopics(books, ['Fiction', 'Empty shelf'])).toEqual([
      'Fiction',
      'Empty shelf',
      'Art',
      'Zoology',
    ])
  })
})

describe('groupByTopic', () => {
  const books = [
    book('frank', ['Fiction', 'Gothic']),
    book('walden', ['Philosophy']),
    book('loose'),
  ]
  const shelves = groupByTopic(books, ['Fiction', 'Gothic', 'Philosophy', 'Science'])

  it('puts a book on every shelf it carries', () => {
    expect(shelves[0]?.books.map((b) => b.id)).toEqual(['frank'])
    expect(shelves[1]?.books.map((b) => b.id)).toEqual(['frank'])
  })
  it('keeps empty shelves', () => {
    expect(shelves[3]).toEqual({ topic: 'Science', books: [] })
  })
  it('ends with the books on no shelf', () => {
    expect(shelves[shelves.length - 1]).toEqual({ topic: null, books: [book('loose')] })
  })
  it('has no loose shelf when every book is shelved', () => {
    expect(groupByTopic([book('a', ['X'])], ['X']).map((s) => s.topic)).toEqual(['X'])
  })
  it('keeps the incoming order on each shelf', () => {
    const sorted = [book('b', ['X']), book('a', ['X'])]
    expect(groupByTopic(sorted, ['X'])[0]?.books.map((b) => b.id)).toEqual(['b', 'a'])
  })
})

describe('changing a book', () => {
  it('adds once', () => {
    expect(withTopic(['Fiction'], 'fiction')).toEqual(['Fiction'])
    expect(withTopic(undefined, 'Gothic')).toEqual(['Gothic'])
  })
  it('removes regardless of case', () => {
    expect(withoutTopic(['Fiction', 'Gothic'], 'GOTHIC')).toEqual(['Fiction'])
  })
  it('renames, merging into an existing name', () => {
    expect(renamedTopic(['Horror', 'Gothic'], 'horror', 'Gothic')).toEqual(['Gothic'])
    expect(renameInOrder(['A', 'B', 'C'], 'b', 'Bee')).toEqual(['A', 'Bee', 'C'])
  })
})

describe('topicSuggestions', () => {
  it('splits publisher subjects into shelf names', () => {
    expect(topicSuggestions(['Horror tales; Science fiction', 'FICTION / Classics'])).toEqual([
      'Horror tales',
      'Science fiction',
      'Fiction',
      'Classics',
    ])
  })
  it('drops call numbers and what the book already has', () => {
    expect(topicSuggestions(['PR4034 .P7 1813', 'Love stories', 'Fiction'], ['fiction'])).toEqual([
      'Love stories',
    ])
  })
  it('offers at most four', () => {
    expect(topicSuggestions(['a1a, bbb, ccc, ddd, eee, fff'])).toHaveLength(4)
  })
})
