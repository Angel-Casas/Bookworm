/**
 * Painted spines: the pure half of asking an image model for a book's spine.
 *
 * The cover goes to the model as a reference and the model paints only the
 * ARTWORK — a small emblem at the top and the cover's ground below it. The
 * title is never painted: image models still garble letters, and a spine is
 * the one place a reader must be able to read them. Bookworm sets it on top,
 * exactly as it does on a spine made from the cover.
 *
 * NanoGPT's Image API does not document its success reply, so `findImage`
 * looks for the picture wherever it turns up (a data URL, a link, or bare
 * base64 under a key that says so). Tried in design-explorations/spine-lab.
 */

export interface SpineModel {
  id: string
  label: string
  /** Sent with every request: every model here draws at 1:3, the nearest to a spine. */
  params: Record<string, string>
}

export const SPINE_MODELS: readonly SpineModel[] = [
  {
    id: 'gpt-image-2.6-flare',
    label: 'GPT Image 2.6 Flare',
    params: { aspect_ratio: '1:3', resolution: '1k', quality: 'medium' },
  },
  {
    id: 'bytedance/seedream-v5.5/edit',
    label: 'Seedream 5.5 Edit',
    params: { aspect_ratio: '1:3', resolution: '1k' },
  },
  {
    id: 'qwen-image-2.1/edit',
    label: 'Qwen Image 2.1 Edit',
    params: { aspect_ratio: '1:3', resolution: '1k' },
  },
]

export const DEFAULT_SPINE_MODEL = SPINE_MODELS[0]!.id

export function isSpineModel(id: unknown): id is string {
  return typeof id === 'string' && SPINE_MODELS.some((model) => model.id === id)
}

export function spineModel(id: string): SpineModel {
  return SPINE_MODELS.find((model) => model.id === id) ?? SPINE_MODELS[0]!
}

/** The share of a painted spine's height the emblem may use; the title is set below it. */
export const PAINTED_EMBLEM_SHARE = 0.3

export function spinePrompt(title: string, author: string | null): string {
  return [
    `The attached image is the front cover of the book "${title}"${author ? ` by ${author}` : ''}.`,
    'Paint the artwork for the SPINE of this same book, as one tall, narrow vertical panel.',
    'Use exactly the cover’s illustration style, colour palette, paper texture and print finish, so the spine and the cover obviously belong to one printed object.',
    'In the top quarter, place one small emblem redrawn from the cover’s main subject, simplified and centred.',
    'Below it, continue the cover’s background colour and texture plainly all the way to the bottom: no further pictures there, because the title will be printed on that area.',
    'Keep every element within the central half of the width; the left and right edges are plain background.',
    'Absolutely no text, letters, numbers, logos, frames or borders.',
  ].join(' ')
}

/** The body of the request to POST /api/v1/images. */
export function spineRequest(
  model: SpineModel,
  coverDataUrl: string,
  title: string,
  author: string | null,
): Record<string, unknown> {
  return {
    model: model.id,
    prompt: spinePrompt(title, author),
    input_references: [coverDataUrl],
    n: 1,
    ...model.params,
  }
}

/** Depth-first search for something that is, or points at, an image. */
export function findImage(value: unknown, key = ''): string | null {
  if (typeof value === 'string') {
    if (value.startsWith('data:image/')) return value
    if (/^https?:\/\//.test(value) && /url|image|output|result|data/i.test(key)) return value
    if (/b64|base64/i.test(key) && value.length > 200) return `data:image/png;base64,${value}`
    return null
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findImage(item, key)
      if (found) return found
    }
    return null
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const found = findImage(v, k)
      if (found) return found
    }
  }
  return null
}

/** The first number under a key that mentions cost, if the reply carries one (USD). */
export function findCost(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null
  for (const [k, v] of Object.entries(value)) {
    if (/cost/i.test(k) && typeof v === 'number' && Number.isFinite(v)) return v
    const nested = findCost(v)
    if (nested !== null) return nested
  }
  return null
}

/**
 * The published price of one image at 1k, from a model's endpoint metadata.
 *
 * Only a ceiling for token-billed models: GPT Image 2.6 Flare lists $0.09 and
 * charged $0.035 for the spines tried in the lab — see `expectedCost`.
 */
export function listedPrice(endpoints: unknown): number | null {
  const first = (endpoints as { endpoints?: { pricing?: unknown }[] } | null)?.endpoints?.[0]
  const pricing = Array.isArray(first?.pricing)
    ? (first.pricing as { cost_usd?: unknown; resolution?: unknown }[])
    : []
  const pick = pricing.find((p) => p.resolution === '1k') ?? pricing[0]
  return typeof pick?.cost_usd === 'number' ? pick.cost_usd : null
}

/**
 * What a spine will probably cost: the latest one actually paid for with this
 * model, when there is one, because that is the reader's real price; the
 * listed price otherwise.
 */
export function expectedCost(
  paid: readonly { modelId: string; costUsd: number | null; at: number }[],
  modelId: string,
  listed: number | null,
): number | null {
  const latest = paid
    .filter((record) => record.modelId === modelId && record.costUsd !== null)
    .sort((a, b) => b.at - a.at)[0]
  return latest?.costUsd ?? listed
}
