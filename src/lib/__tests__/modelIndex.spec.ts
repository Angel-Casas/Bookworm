import { describe, expect, it } from 'vitest'
import {
  buildModelGroups,
  formatContext,
  formatModelPrice,
  houseCounts,
  houseOf,
  isSelectableModel,
  matchesQuery,
  OTHER_HOUSE,
  type PickerModel,
} from '../modelIndex'

const model = (id: string, name: string, prompt: number | null = 1, completion = 2): PickerModel => ({
  id,
  name,
  contextLength: 128000,
  promptPrice: prompt,
  completionPrice: prompt === null ? null : completion,
})

describe('houseOf', () => {
  it('reads the house from the id prefix', () => {
    expect(houseOf(model('anthropic/claude-opus-5', 'Claude Opus 5'))).toBe('Anthropic')
    expect(houseOf(model('openai/gpt-5', 'GPT 5'))).toBe('OpenAI')
    expect(houseOf(model('google/gemini-pro', 'Gemini Pro'))).toBe('Google')
    expect(houseOf(model('x-ai/grok-4.6', 'Grok 4.6'))).toBe('xAI')
  })

  it('falls back to the name when the id carries no house', () => {
    expect(houseOf(model('claude-sonnet-4-5-20250929', 'Claude Sonnet 4.5'))).toBe('Anthropic')
    expect(houseOf(model('deepseek-chat', 'DeepSeek V3'))).toBe('DeepSeek')
  })

  it('puts anything unrecognised in one bucket rather than inventing a house', () => {
    expect(houseOf(model('sakana/fugu-ultra', 'Fugu Ultra'))).toBe(OTHER_HOUSE)
  })
})

describe('matchesQuery', () => {
  const claude = model('anthropic/claude-opus-5', 'Claude Opus 5')

  it('matches on name, id or house', () => {
    expect(matchesQuery(claude, 'opus')).toBe(true)
    expect(matchesQuery(claude, 'anthropic')).toBe(true)
    expect(matchesQuery(claude, 'claude-opus')).toBe(true)
  })

  it('takes every word, in any order', () => {
    expect(matchesQuery(claude, 'opus claude')).toBe(true)
    expect(matchesQuery(claude, 'anthropic opus')).toBe(true)
    expect(matchesQuery(claude, 'opus gemini')).toBe(false)
  })

  it('matches everything on an empty query', () => {
    expect(matchesQuery(claude, '')).toBe(true)
    expect(matchesQuery(claude, '   ')).toBe(true)
  })
})

describe('buildModelGroups', () => {
  const models = [
    model('anthropic/claude-opus-5', 'Claude Opus 5', 5, 25),
    model('openai/gpt-5', 'GPT 5', 1.25, 10),
    model('openai/gpt-5-nano', 'GPT 5 Nano', 0.05, 0.4),
    model('sakana/fugu-ultra', 'Fugu Ultra', 5.25, 31.5),
  ]
  const base = { models, query: '', sort: 'house' as const, favouriteIds: [] as string[] }

  it('groups by house, known houses first and the catch-all last', () => {
    const groups = buildModelGroups(base)
    expect(groups.map((group) => group.house)).toEqual(['OpenAI', 'Anthropic', OTHER_HOUSE])
  })

  it('lifts favourites into their own group at the top', () => {
    const groups = buildModelGroups({ ...base, favouriteIds: ['openai/gpt-5'] })
    expect(groups[0]?.house).toBe('Favourites')
    expect(groups[0]?.models.map((m) => m.id)).toEqual(['openai/gpt-5'])
    // …and never twice.
    expect(groups.slice(1).flatMap((g) => g.models.map((m) => m.id))).not.toContain('openai/gpt-5')
  })

  it('orders by total price when asked, cheapest first', () => {
    const groups = buildModelGroups({ ...base, sort: 'cheapest' })
    expect(groups[0]?.models.map((m) => m.name)).toEqual([
      'GPT 5 Nano',
      'GPT 5',
      'Claude Opus 5',
      'Fugu Ultra',
    ])
  })

  it('reverses for priciest', () => {
    const groups = buildModelGroups({ ...base, sort: 'priciest' })
    expect(groups[0]?.models[0]?.name).toBe('Fugu Ultra')
  })

  it('sorts an unpriced model last either way — an unknown price is not a bargain', () => {
    const withUnknown = [...models, model('mystery/x', 'Mystery', null)]
    for (const sort of ['cheapest', 'priciest'] as const) {
      const groups = buildModelGroups({ ...base, models: withUnknown, sort })
      const list = groups[0]?.models ?? []
      expect(list[list.length - 1]?.name).toBe('Mystery')
    }
  })

  it('drops a flat sort into one run rather than pretending to group', () => {
    const groups = buildModelGroups({ ...base, sort: 'name' })
    expect(groups).toHaveLength(1)
    expect(groups[0]?.models.map((m) => m.name)).toEqual([
      'Claude Opus 5',
      'Fugu Ultra',
      'GPT 5',
      'GPT 5 Nano',
    ])
  })

  it('narrows to a searched word', () => {
    const groups = buildModelGroups({ ...base, query: 'nano' })
    expect(groups.flatMap((g) => g.models.map((m) => m.id))).toEqual(['openai/gpt-5-nano'])
  })

  it('narrows to chosen houses', () => {
    const groups = buildModelGroups({ ...base, houses: ['Anthropic'] })
    expect(groups.map((g) => g.house)).toEqual(['Anthropic'])
  })

  it('returns nothing rather than an empty group when nothing matches', () => {
    expect(buildModelGroups({ ...base, query: 'zzz' })).toEqual([])
  })
})

describe('what belongs in the list at all', () => {
  it('keeps models to read with', () => {
    expect(isSelectableModel(model('anthropic/claude-opus-5', 'Claude Opus 5'))).toBe(true)
    expect(isSelectableModel(model('auto-model', 'Auto model'))).toBe(true)
  })

  it('drops the support assistant, which is not a book’s model', () => {
    expect(isSelectableModel(model('nano-gpt-help', 'NanoGPT Help'))).toBe(false)
    expect(isSelectableModel(model('NANO-GPT-HELP', 'NanoGPT Help'))).toBe(false)
  })
})

describe('a price that varies', () => {
  const list = [
    model('openai/gpt-5-nano', 'GPT 5 Nano', 0.05, 0.4),
    model('auto-model', 'Auto model', 0, 0),
    model('anthropic/claude-opus-5', 'Claude Opus 5', 5, 25),
  ]
  const base = { models: list, query: '', favouriteIds: [] as string[] }

  it('is not the cheapest price — it sorts with the unknowns, at the end', () => {
    const cheapest = buildModelGroups({ ...base, sort: 'cheapest' })
    expect(cheapest[0]?.models.map((m) => m.name)).toEqual([
      'GPT 5 Nano',
      'Claude Opus 5',
      'Auto model',
    ])
  })

  it('and is not the priciest either', () => {
    const priciest = buildModelGroups({ ...base, sort: 'priciest' })
    const names = priciest[0]?.models.map((m) => m.name) ?? []
    expect(names[names.length - 1]).toBe('Auto model')
  })
})

describe('houseCounts', () => {
  it('counts each house, in listing order', () => {
    const counts = houseCounts([
      model('openai/gpt-5', 'GPT 5'),
      model('openai/gpt-5-nano', 'GPT 5 Nano'),
      model('anthropic/claude-opus-5', 'Claude Opus 5'),
      model('sakana/fugu', 'Fugu'),
    ])
    expect(counts).toEqual([
      { house: 'OpenAI', count: 2 },
      { house: 'Anthropic', count: 1 },
      { house: OTHER_HOUSE, count: 1 },
    ])
  })
})

describe('prices and context', () => {
  it('states both halves of the price, per million', () => {
    expect(formatModelPrice(model('a', 'A', 3, 15))).toBe('in $3 · out $15')
    expect(formatModelPrice(model('a', 'A', 0.05, 0.4))).toBe('in $0.05 · out $0.40')
  })

  it('keeps both cents digits so a column of prices lines up as money', () => {
    expect(formatModelPrice(model('a', 'A', 1.1, 4.4))).toBe('in $1.10 · out $4.40')
  })

  it('says free rather than $0', () => {
    expect(formatModelPrice(model('a', 'A', 0, 0))).toBe('free')
  })

  it('admits when it does not know', () => {
    expect(formatModelPrice(model('a', 'A', null))).toBe('price unknown')
  })

  it('says a varying price varies rather than calling zero "free"', () => {
    // The auto model forwards each request to whichever model suits it, and
    // the API reports zeroes for it — which would read as free.
    expect(formatModelPrice(model('auto-model', 'Auto model', 0, 0))).toBe('price varies by model')
    expect(formatModelPrice(model('auto-model', 'Auto model', null))).toBe('price varies by model')
  })

  it('rounds a very large price rather than printing cents nobody reads', () => {
    expect(formatModelPrice(model('a', 'A', 1312.5, 1312.5))).toBe('in $1313 · out $1313')
  })

  it('states the context window compactly, or not at all', () => {
    expect(formatContext({ ...model('a', 'A'), contextLength: 128000 })).toBe('128k context')
    expect(formatContext({ ...model('a', 'A'), contextLength: 2_000_000 })).toBe('2M context')
    expect(formatContext({ ...model('a', 'A'), contextLength: null })).toBe('')
  })
})
