/**
 * Painting a spine through NanoGPT's Image API (network side effects only;
 * the request and the reading of the reply are in lib/spineArt).
 *
 * POST https://api.nano-gpt.com/api/v1/images, the cover as a data-URL
 * reference. Tried for real in design-explorations/spine-lab: the reply
 * carries the image and a `cost`, and the host allows reading it from a page.
 */
import { NanoGptError } from '@/services/nanogpt'
import { findCost, findImage, listedPrice, spineRequest, type SpineModel } from '@/lib/spineArt'

const IMAGE_API = 'https://api.nano-gpt.com/api/v1'

export class NoImageError extends Error {
  constructor() {
    super('The reply did not contain an image.')
    this.name = 'NoImageError'
  }
}

export interface PaintedSpine {
  blob: Blob
  /** USD, as the reply states it; null when it does not. */
  costUsd: number | null
}

async function reach(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch {
    throw new NanoGptError('Could not reach NanoGPT.', null)
  }
}

export async function paintSpine(
  apiKey: string,
  model: SpineModel,
  coverDataUrl: string,
  title: string,
  author: string | null,
): Promise<PaintedSpine> {
  const response = await reach(`${IMAGE_API}/images`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(spineRequest(model, coverDataUrl, title, author)),
  })
  if (!response.ok) {
    throw new NanoGptError(`Image request failed (HTTP ${response.status}).`, response.status)
  }
  const body: unknown = await response.json()
  const source = findImage(body)
  if (!source) throw new NoImageError()
  const image = await reach(source)
  if (!image.ok) throw new NoImageError()
  return { blob: await image.blob(), costUsd: findCost(body) }
}

/** The listed 1k price of a model; null when it cannot be had. Needs no key. */
export async function fetchListedPrice(modelId: string): Promise<number | null> {
  try {
    const response = await fetch(`${IMAGE_API}/images/models/${modelId}/endpoints`)
    return response.ok ? listedPrice(await response.json()) : null
  } catch {
    return null
  }
}
