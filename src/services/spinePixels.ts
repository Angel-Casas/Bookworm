/**
 * The canvas half of spine design: turn images into the small PixelGrids that
 * lib/spine reads, and shrink a painted spine to the size the shelf draws it.
 */
import {
  findMotif,
  spineColors,
  type Motif,
  type PixelGrid,
  type Region,
  type SpineColors,
} from '@/lib/spine'

/** The motif box on a spine is its own width across and 1.2 widths tall. */
export const MOTIF_ASPECT = 1.2

async function bitmapOf(source: Blob): Promise<ImageBitmap> {
  return createImageBitmap(source)
}

function canvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const element = document.createElement('canvas')
  element.width = width
  element.height = height
  return element
}

async function gridOf(bitmap: ImageBitmap, width: number): Promise<PixelGrid> {
  const height = Math.max(1, Math.round((width * bitmap.height) / bitmap.width))
  const surface = canvas(width, height)
  const context = surface.getContext('2d', { willReadFrequently: true }) as
    OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
  context.drawImage(bitmap, 0, 0, width, height)
  return { width, height, data: context.getImageData(0, 0, width, height).data }
}

export interface CoverReading {
  colors: SpineColors
  motif: Motif | null
}

/**
 * Colours from a 120 px copy, the motif from a 64 px one — small on purpose:
 * at that size type blurs into texture and a picture stays a picture.
 */
export async function readCover(cover: Blob): Promise<CoverReading> {
  const bitmap = await bitmapOf(cover)
  try {
    const colors = spineColors(await gridOf(bitmap, 120))
    return { colors, motif: findMotif(await gridOf(bitmap, 64), colors.ground, MOTIF_ASPECT) }
  } finally {
    bitmap.close()
  }
}

/** A painted spine's title area — where the title is set, so where its ground is read. */
const PAINTED_TITLE_AREA: Region = { x: 0.3, y: 0.35, w: 0.4, h: 0.6 }

export async function readPaintedSpine(image: Blob): Promise<SpineColors> {
  const bitmap = await bitmapOf(image)
  try {
    return spineColors(await gridOf(bitmap, 60), PAINTED_TITLE_AREA)
  } finally {
    bitmap.close()
  }
}

async function encode(
  surface: OffscreenCanvas | HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> {
  if ('convertToBlob' in surface) return surface.convertToBlob({ type, quality })
  return new Promise((resolve, reject) =>
    surface.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('encode failed'))),
      type,
      quality,
    ),
  )
}

/**
 * A painted spine at the size it is drawn: models answer with a 1.3 MB PNG,
 * and the shelf never shows one more than 600 px tall even on a dense screen.
 */
export async function shrinkSpine(image: Blob, height = 600): Promise<Blob> {
  const bitmap = await bitmapOf(image)
  try {
    const scale = Math.min(1, height / bitmap.height)
    const surface = canvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale))
    const context = surface.getContext('2d') as
      OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
    context.drawImage(bitmap, 0, 0, surface.width, surface.height)
    return await encode(surface, 'image/webp', 0.86)
  } finally {
    bitmap.close()
  }
}

/** A cover as a JPEG data URL no taller than `maxHeight`, to send as a reference image. */
export async function coverDataUrl(cover: Blob, maxHeight = 1024): Promise<string> {
  const bitmap = await bitmapOf(cover)
  try {
    const scale = Math.min(1, maxHeight / bitmap.height)
    const surface = canvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale))
    const context = surface.getContext('2d') as
      OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
    context.drawImage(bitmap, 0, 0, surface.width, surface.height)
    const blob = await encode(surface, 'image/jpeg', 0.9)
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
  } finally {
    bitmap.close()
  }
}
