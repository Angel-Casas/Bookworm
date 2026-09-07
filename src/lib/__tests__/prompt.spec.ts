import { describe, expect, it } from 'vitest'
import {
  OPENINGS,
  QUIZ_QUESTION,
  buildMessages,
  buildSystemPrompt,
  buildUserMessage,
} from '../prompt'
import type { Reference } from '../prompt'

const book = { title: 'Dune', author: 'Frank Herbert' }
const selection: Reference = {
  kind: 'selection',
  label: 'Highlighted text',
  text: 'Fear is the mind-killer.',
}

describe('buildSystemPrompt', () => {
  it('mentions the book, author and default no-spoiler policy', () => {
    const prompt = buildSystemPrompt(book, false)
    expect(prompt).toContain('"Dune" by Frank Herbert')
    expect(prompt).toContain('Avoid spoilers')
  })
  it('switches policy when spoilers are allowed', () => {
    expect(buildSystemPrompt(book, true)).toContain('opted in to spoilers')
  })
  it('omits author gracefully', () => {
    expect(buildSystemPrompt({ title: 'Anon', author: null }, false)).toContain('"Anon".')
  })

  it('asks for the reader’s language, and leaves the book in its own', () => {
    const prompt = buildSystemPrompt(book, false, [], 'Español')
    expect(prompt).toContain('Answer in Español')
    // The passages themselves are not to be translated on the way past.
    expect(prompt).toMatch(/do not translate a passage unless the reader asks/i)
  })

  it('says nothing about language when the reader reads English', () => {
    // Telling a model to answer in English earns nothing but tokens.
    expect(buildSystemPrompt(book, false, [], null)).not.toMatch(/Answer in/i)
  })
})

describe('buildUserMessage', () => {
  it('separates references from the question', () => {
    const message = buildUserMessage('What does this mean?', [selection])
    expect(message).toContain('<reference kind="selection" label="Highlighted text">')
    expect(message).toContain('Fear is the mind-killer.')
    expect(message).toContain('</reference>')
    expect(message).toMatch(/Question: What does this mean\?$/)
  })
  it('sends a bare question when there are no references', () => {
    expect(buildUserMessage('Hello?', [])).toBe('Hello?')
  })
})

describe('buildMessages', () => {
  it('carries the reader’s language into the system turn', () => {
    const system = buildMessages(book, false, [], 'Why?', [], '日本語')[0]
    expect(system?.role).toBe('system')
    expect(system?.content).toContain('Answer in 日本語')
  })

  it('assembles system + history + new user message', () => {
    const history = [
      { role: 'user' as const, content: 'Hi' },
      { role: 'assistant' as const, content: 'Hello!' },
    ]
    const messages = buildMessages(book, false, history, 'Next question', [])
    expect(messages).toHaveLength(4)
    expect(messages[0]!.role).toBe('system')
    expect(messages[messages.length - 1]).toEqual({ role: 'user', content: 'Next question' })
  })
  it('strips stray system messages from history', () => {
    const history = [{ role: 'system' as const, content: 'rogue' }]
    const messages = buildMessages(book, false, history, 'Q', [])
    expect(messages.filter((m) => m.role === 'system')).toHaveLength(1)
  })
})

describe('citation and quoting policy', () => {
  it('names the labels it is allowed to cite', () => {
    const prompt = buildSystemPrompt({ title: 'B', author: null }, false, ['Chapter 4'])
    expect(prompt).toContain('[Chapter 4]')
    expect(prompt).toContain('never invent one')
  })

  it('says nothing about citing when nothing was sent to cite', () => {
    const prompt = buildSystemPrompt({ title: 'B', author: null }, false, [])
    expect(prompt).not.toContain('square')
  })

  it('invites verbatim quoting — the reader owns the file', () => {
    const prompt = buildSystemPrompt({ title: 'B', author: null }, false)
    expect(prompt).toContain('verbatim')
    expect(prompt).toContain('markdown')
  })

  it('lets the model cite exactly the references the message carries', () => {
    const messages = buildMessages({ title: 'B', author: null }, false, [], 'why?', [
      { kind: 'section', label: 'Chapter 4', text: 'text' },
    ])
    expect(messages[0]?.content).toContain('[Chapter 4]')
  })
})

describe('openings', () => {
  it('offers the recap over everything read so far, not just this chapter', () => {
    const recap = OPENINGS.find((opening) => opening.id === 'recap')
    expect(recap?.scope).toBe('book-so-far')
    expect(recap?.question).toContain('do not mention anything from later')
  })

  it('only offers passage explanation when there is a passage', () => {
    expect(OPENINGS.find((opening) => opening.id === 'explain')?.needsSelection).toBe(true)
    expect(OPENINGS.filter((opening) => opening.needsSelection).length).toBe(1)
  })

  it('summarises what is in front of the reader, and nothing past it', () => {
    const summary = OPENINGS.find((opening) => opening.id === 'summary')
    expect(summary?.labelKey).toBe('opening.summary')
    expect(summary?.scope).toBe('section')
    expect(summary?.question).toContain('not summarise anything from later')
  })

  it('gives every opening enough context to be answerable', () => {
    for (const opening of OPENINGS) {
      expect(['keep', 'section', 'book-so-far']).toContain(opening.scope)
      expect(opening.question.length).toBeGreaterThan(20)
    }
  })

  it('keeps the quiz reachable under its old name', () => {
    expect(QUIZ_QUESTION).toBe(OPENINGS.find((opening) => opening.id === 'quiz')?.question)
  })
})
