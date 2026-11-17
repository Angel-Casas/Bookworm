import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SPINE_MODEL,
  SPINE_MODELS,
  expectedCost,
  findCost,
  findImage,
  isSpineModel,
  listedPrice,
  spineModel,
  spineRequest,
} from '../spineArt'

describe('spine models', () => {
  it('knows its own models and nothing else', () => {
    expect(isSpineModel(DEFAULT_SPINE_MODEL)).toBe(true)
    expect(isSpineModel('gpt-4o')).toBe(false)
    expect(isSpineModel(null)).toBe(false)
  })

  it('falls back to the default for an id it does not know', () => {
    expect(spineModel('gone').id).toBe(DEFAULT_SPINE_MODEL)
  })

  it('asks every model for a tall, narrow image', () => {
    for (const model of SPINE_MODELS) expect(model.params.aspect_ratio).toBe('1:3')
  })
})

describe('spineRequest', () => {
  it('sends the cover as a reference and never asks for lettering', () => {
    const body = spineRequest(SPINE_MODELS[0]!, 'data:image/jpeg;base64,AAA', 'Iron Tide', null)
    expect(body.input_references).toEqual(['data:image/jpeg;base64,AAA'])
    expect(body.model).toBe(SPINE_MODELS[0]!.id)
    expect(String(body.prompt)).toMatch(/no text/i)
    expect(String(body.prompt)).toContain('"Iron Tide"')
  })
})

describe('findImage', () => {
  const b64 = 'A'.repeat(300)

  it('finds base64 the way OpenAI-shaped replies carry it', () => {
    expect(findImage({ data: [{ b64_json: b64 }] })).toBe(`data:image/png;base64,${b64}`)
  })

  it('finds a link', () => {
    expect(findImage({ data: [{ url: 'https://cdn.example/x.png' }] })).toBe(
      'https://cdn.example/x.png',
    )
  })

  it('finds a data URL anywhere', () => {
    expect(findImage({ result: { images: ['data:image/webp;base64,xyz'] } })).toBe(
      'data:image/webp;base64,xyz',
    )
  })

  it('does not mistake any link for the picture', () => {
    expect(findImage({ docs: 'https://docs.nano-gpt.com', status: 'failed' })).toBeNull()
  })
})

describe('costs', () => {
  it('reads a cost wherever the reply puts it', () => {
    expect(findCost({ data: [], cost: 0.0349 })).toBe(0.0349)
    expect(findCost({ usage: { cost_usd: 0.02 } })).toBe(0.02)
    expect(findCost({ data: [] })).toBeNull()
  })

  it('reads the 1k price from endpoint metadata', () => {
    const meta = {
      endpoints: [
        {
          pricing: [
            { cost_usd: 0.18, resolution: '2k' },
            { cost_usd: 0.09, resolution: '1k' },
          ],
        },
      ],
    }
    expect(listedPrice(meta)).toBe(0.09)
    expect(listedPrice({})).toBeNull()
  })

  it('expects what was last paid, over the listed price', () => {
    const paid = [
      { modelId: 'm', costUsd: 0.03, at: 1 },
      { modelId: 'm', costUsd: 0.035, at: 2 },
      { modelId: 'other', costUsd: 1, at: 3 },
    ]
    expect(expectedCost(paid, 'm', 0.09)).toBe(0.035)
    expect(expectedCost(paid, 'new', 0.09)).toBe(0.09)
  })
})
