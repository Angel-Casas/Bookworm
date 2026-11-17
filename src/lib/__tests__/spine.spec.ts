import { describe, expect, it } from 'vitest'
import {
  bindingColors,
  contrast,
  findMotif,
  fitTitle,
  hash,
  motifAt,
  palette,
  spineAuthor,
  spineColors,
  spineTitle,
  spineWidth,
  type PixelGrid,
  type Rgb,
} from '../spine'

/** A grid painted by a function of (x, y). */
function grid(width: number, height: number, paint: (x: number, y: number) => Rgb): PixelGrid {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const { r, g, b } = paint(x, y)
      const i = (y * width + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 255
    }
  }
  return { width, height, data }
}

const NAVY: Rgb = { r: 18, g: 28, b: 52 }
const CREAM: Rgb = { r: 238, g: 226, b: 200 }
const RED: Rgb = { r: 214, g: 72, b: 48 }

describe('palette', () => {
  it('finds a flat colour as one swatch holding everything', () => {
    const swatches = palette(grid(10, 10, () => NAVY))
    expect(swatches).toHaveLength(1)
    expect(swatches[0]!.weight).toBe(1)
    expect(swatches[0]!.color).toEqual(NAVY)
  })

  it('merges grain into its colour instead of counting it twice', () => {
    const noisy = grid(20, 20, (x, y) => ({ r: NAVY.r + ((x * 7 + y) % 9), g: NAVY.g, b: NAVY.b }))
    expect(palette(noisy)).toHaveLength(1)
  })

  it('weighs two colours by their share, heaviest first', () => {
    const swatches = palette(grid(10, 10, (x) => (x < 7 ? CREAM : RED)))
    expect(swatches.map((s) => s.weight)).toEqual([0.7, 0.3])
  })
})

describe('spineColors', () => {
  it('takes the ground from the left edge, where the spine folds round', () => {
    // A cream cover whose right half is a red picture.
    const colors = spineColors(grid(40, 60, (x) => (x < 20 ? CREAM : RED)))
    expect(colors.ground).toEqual(CREAM)
  })

  it('always gives ink that reads on the ground', () => {
    for (const ground of [NAVY, CREAM, RED, { r: 128, g: 128, b: 128 }]) {
      const colors = spineColors(grid(20, 30, () => ground))
      expect(contrast(colors.ink, colors.ground)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('prefers a colour already on the cover for the ink', () => {
    const colors = spineColors(grid(40, 60, (x, y) => (y > 10 && y < 20 && x > 10 ? CREAM : NAVY)))
    expect(colors.ink).toEqual(CREAM)
  })
})

describe('findMotif', () => {
  it('finds a solid shape on a plain cover, and frames it', () => {
    // A red sun centred at (32, 40) on cream.
    const cover = grid(64, 96, (x, y) => (Math.hypot(x - 32, y - 40) < 10 ? RED : CREAM))
    const motif = findMotif(cover, CREAM)
    expect(motif).not.toBeNull()
    const cx = (motif!.x + motif!.w / 2) * 64
    const cy = (motif!.y + motif!.h / 2) * 96
    expect(Math.abs(cx - 32)).toBeLessThan(6)
    // A gentle pull to the middle of the cover moves the window a little.
    expect(Math.abs(cy - 40)).toBeLessThanOrEqual(10)
  })

  it('finds nothing on a plain cover', () => {
    expect(
      findMotif(
        grid(64, 96, () => CREAM),
        CREAM,
      ),
    ).toBeNull()
  })

  it('reads thin strokes as type, not as a picture', () => {
    // Rows of one-pixel hairlines: what set type looks like once shrunk.
    const lines = grid(64, 96, (x, y) => (y % 3 === 0 && x % 4 !== 0 ? NAVY : CREAM))
    expect(findMotif(lines, CREAM)).toBeNull()
  })

  it('keeps the requested shape', () => {
    const cover = grid(64, 96, (x, y) => (Math.hypot(x - 32, y - 40) < 10 ? RED : CREAM))
    const motif = findMotif(cover, CREAM, 1.2)!
    expect((motif.h * 96) / (motif.w * 64)).toBeCloseTo(1.2, 1)
  })
})

describe('motifAt', () => {
  it('centres the window on the point, inside the cover', () => {
    expect(motifAt({ x: 0, y: 0, w: 0.4, h: 0.3 }, 0.5, 0.5)).toEqual({
      x: 0.3,
      y: 0.35,
      w: 0.4,
      h: 0.3,
    })
    const edge = motifAt({ x: 0, y: 0, w: 0.4, h: 0.3 }, 0.99, 0.01)
    expect(edge.x).toBeCloseTo(0.6)
    expect(edge.y).toBe(0)
  })
})

describe('spine geometry', () => {
  it('gives the same book the same width every time', () => {
    expect(spineWidth('abc', null)).toBe(spineWidth('abc', null))
    expect(hash('abc')).toBe(hash('abc'))
  })

  it('keeps every width inside the range', () => {
    for (const id of ['a', 'b', 'c', 'some-long-id', '11aa4021']) {
      const w = spineWidth(id, null, 34, 56)
      expect(w).toBeGreaterThanOrEqual(34)
      expect(w).toBeLessThanOrEqual(56)
    }
  })

  it('makes a long book thicker than a short one', () => {
    expect(spineWidth('x', 900)).toBeGreaterThan(spineWidth('x', 120))
  })
})

describe('fitTitle', () => {
  it('sets a short title in one column, as large as the spine allows', () => {
    const fit = fitTitle('Iron Tide', 200, 40)
    expect(fit.lines).toEqual(['Iron Tide'])
    expect(fit.size).toBe(20)
  })

  it('folds a long title at its most balanced word break', () => {
    const fit = fitTitle("The Cartographer's Daughter of the North", 160, 40)
    expect(fit.lines).toHaveLength(2)
    expect(fit.lines.join(' ')).toBe("The Cartographer's Daughter of the North")
    const [a, b] = fit.lines.map((line) => line.length)
    expect(Math.abs(a! - b!)).toBeLessThan(12)
  })

  it('never folds a single word', () => {
    expect(fitTitle('Supercalifragilisticexpialidocious', 100, 40).lines).toHaveLength(1)
  })
})

describe('spineTitle', () => {
  it('keeps the main title only', () => {
    expect(spineTitle('Rocks of Ages: Science and Religion in the Fullness of Life')).toBe(
      'Rocks of Ages',
    )
    expect(spineTitle('45 Years in Wall Street (1949) / New Stock Trend Detector (1936)')).toBe(
      '45 Years in Wall Street',
    )
    expect(spineTitle('Dune — Book One')).toBe('Dune')
  })

  it('leaves a plain title alone', () => {
    expect(spineTitle('The Lantern Keeper')).toBe('The Lantern Keeper')
  })

  it('never returns nothing', () => {
    expect(spineTitle('(1949)')).toBe('(1949)')
  })
})

describe('spineAuthor', () => {
  it('gives the surname of the first author', () => {
    expect(spineAuthor('Stephen Jay Gould')).toBe('Gould')
    expect(spineAuthor('Will Durant and Ariel Durant')).toBe('Durant')
    expect(spineAuthor('GANN, W.D.')).toBe('GANN')
    expect(spineAuthor(null)).toBe('')
  })
})

describe('bindingColors', () => {
  it('is the same for the same book, and readable', () => {
    expect(bindingColors('a')).toEqual(bindingColors('a'))
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      const colors = bindingColors(id)
      expect(contrast(colors.ink, colors.ground)).toBeGreaterThanOrEqual(4.5)
    }
  })
})
