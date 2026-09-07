import { describe, expect, it } from 'vitest'
import { buildLookupMessages, lookupTerm, sentenceAround } from '../lookup'

const BOOK = { title: 'Moby-Dick', author: 'Herman Melville' }

describe('lookupTerm', () => {
  it('takes a word', () => {
    expect(lookupTerm('gunwale')).toBe('gunwale')
  })

  it('tidies what a finger actually catches', () => {
    expect(lookupTerm('  gunwale,  ')).toBe('gunwale')
    expect(lookupTerm('“Ishmael”')).toBe('Ishmael')
    expect(lookupTerm('sperm\nwhale')).toBe('sperm whale')
  })

  it('allows a short phrase, because names come in twos', () => {
    expect(lookupTerm('Father Mapple')).toBe('Father Mapple')
  })

  it('refuses a passage — that is a question for the assistant', () => {
    expect(lookupTerm('Call me Ishmael. Some years ago, never mind how long')).toBeNull()
    expect(lookupTerm('one two three four five')).toBeNull()
  })

  it('refuses what is not a word at all', () => {
    expect(lookupTerm('   ')).toBeNull()
    expect(lookupTerm('— — —')).toBeNull()
    expect(lookupTerm('147')).toBeNull()
  })
})

describe('sentenceAround', () => {
  const context =
    'It was a damp, drizzly November in my soul. I found myself pausing before coffin ' +
    'warehouses. Then I account it high time to get to sea.'

  it('returns the sentence the word sits in', () => {
    expect(sentenceAround(context, 'coffin')).toBe(
      'I found myself pausing before coffin warehouses.',
    )
  })

  it('takes the first sentence and the last just as happily', () => {
    expect(sentenceAround(context, 'drizzly')).toBe('It was a damp, drizzly November in my soul.')
    expect(sentenceAround(context, 'sea')).toBe('Then I account it high time to get to sea.')
  })

  it('does not mistake an abbreviation for a full stop', () => {
    const text = 'Mr. Bennet was so odd a mixture of quick parts. She had a mean understanding.'
    expect(sentenceAround(text, 'mixture')).toBe('Mr. Bennet was so odd a mixture of quick parts.')
    const initials = 'H. G. Wells wrote it. Nobody minded.'
    expect(sentenceAround(initials, 'wrote')).toBe('H. G. Wells wrote it.')
  })

  it('flattens the line breaks a page lays in', () => {
    expect(sentenceAround('a damp,\n  drizzly   November.', 'drizzly')).toBe(
      'a damp, drizzly November.',
    )
  })

  it('still gives context when the word cannot be found', () => {
    // A selection split across two elements, or a PDF text layer that broke the
    // word in half — the surrounding text is still worth sending.
    expect(sentenceAround(context, 'leviathan')).toContain('damp, drizzly')
  })

  it('keeps the word inside a sentence too long to send whole', () => {
    const long = `${'padding word '.repeat(40)}gunwale${' more padding'.repeat(40)}.`
    const clipped = sentenceAround(long, 'gunwale', 120)
    expect(clipped.length).toBeLessThanOrEqual(124)
    expect(clipped).toContain('gunwale')
  })

  it('has nothing to say about nothing', () => {
    expect(sentenceAround('', 'gunwale')).toBe('')
  })
})

describe('buildLookupMessages', () => {
  it('asks a small question, with the sentence attached', () => {
    const messages = buildLookupMessages(BOOK, 'gunwale', 'He leaned on the gunwale.', false)
    const [system, user] = [messages[0]!, messages[1]!]
    expect(system.role).toBe('system')
    expect(system.content).toContain('Moby-Dick')
    expect(system.content).toContain('two short sentences')
    expect(user.content).toContain('gunwale')
    expect(user.content).toContain('He leaned on the gunwale.')
  })

  it('keeps the spoiler promise the rest of the app makes', () => {
    const guarded = buildLookupMessages(BOOK, 'Ahab', '', false)[0]!.content
    expect(guarded).toContain('later in the book')
    const open = buildLookupMessages(BOOK, 'Ahab', '', true)[0]!.content
    expect(open).toContain('opted in')
  })

  it('writes the note in the reader’s language when it is not English', () => {
    const spanish = buildLookupMessages(BOOK, 'gunwale', '', false, 'Español')[0]!.content
    expect(spanish).toContain('Español')
    const english = buildLookupMessages(BOOK, 'gunwale', '', false)[0]!.content
    expect(english).not.toMatch(/Write the note in/)
  })

  it('carries no history, so a gloss costs what a gloss costs', () => {
    expect(buildLookupMessages(BOOK, 'gunwale', 'He leaned on the gunwale.', false)).toHaveLength(2)
  })
})
