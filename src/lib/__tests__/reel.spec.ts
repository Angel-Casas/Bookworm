import { describe, expect, it } from 'vitest'
import {
  activeBeatIndex,
  beatOpacity,
  chooseReelSource,
  expBlend,
  quantizeToFilmFrame,
  REEL_BEATS,
  REEL_SPS,
  smoothstep,
  trackHeight,
} from '../reel'

describe('smoothstep', () => {
  it('clamps and eases across the window', () => {
    expect(smoothstep(0, 1, 2)).toBe(0)
    expect(smoothstep(3, 1, 2)).toBe(1)
    expect(smoothstep(1.5, 1, 2)).toBeCloseTo(0.5, 5)
    expect(smoothstep(1.25, 1, 2)).toBeLessThan(0.25) // ease-in
  })
  it('degenerates to a step for empty windows', () => {
    expect(smoothstep(0.9, 1, 1)).toBe(0)
    expect(smoothstep(1.1, 1, 1)).toBe(1)
  })
})

describe('beatOpacity', () => {
  const beat = { id: 'x', fadeInStart: 1, fullyIn: 2, fadeOutStart: 4, fullyOut: 5, label: 'X' }
  it('is 0 before, 1 during, 0 after', () => {
    expect(beatOpacity(0.5, beat)).toBe(0)
    expect(beatOpacity(3, beat)).toBe(1)
    expect(beatOpacity(6, beat)).toBe(0)
  })
  it('the hero beat is fully visible at film time 0', () => {
    expect(beatOpacity(0, REEL_BEATS[0]!)).toBe(1)
  })
  it('the final beat never fades out', () => {
    expect(beatOpacity(60, REEL_BEATS[REEL_BEATS.length - 1]!)).toBe(1)
  })
})

describe('REEL_BEATS integrity', () => {
  it('beats are ordered and windows are sane', () => {
    for (const beat of REEL_BEATS) {
      expect(beat.fadeInStart).toBeLessThan(beat.fullyIn)
      expect(beat.fullyIn).toBeLessThanOrEqual(beat.fadeOutStart)
      expect(beat.fadeOutStart).toBeLessThan(beat.fullyOut)
    }
    for (let i = 1; i < REEL_BEATS.length; i += 1) {
      expect(REEL_BEATS[i]!.fadeInStart).toBeGreaterThan(REEL_BEATS[i - 1]!.fadeInStart)
    }
  })
  it('at most one beat is dominant at any time', () => {
    for (let t = 0; t <= 14; t += 0.05) {
      const dominant = REEL_BEATS.filter((beat) => beatOpacity(t, beat) > 0.6)
      expect(dominant.length).toBeLessThanOrEqual(1)
    }
  })
})

describe('activeBeatIndex', () => {
  it('tracks progression through the film', () => {
    expect(activeBeatIndex(0, REEL_BEATS)).toBe(0)
    expect(activeBeatIndex(3.0, REEL_BEATS)).toBe(2)
    expect(activeBeatIndex(13.5, REEL_BEATS)).toBe(REEL_BEATS.length - 1)
  })
})

describe('chooseReelSource', () => {
  it('selects by codec support first, then viewport', () => {
    expect(chooseReelSource(false, true)).toBe('/landing/scrub-1920.mp4')
    expect(chooseReelSource(true, true)).toBe('/landing/scrub-960.mp4')
    expect(chooseReelSource(false, false)).toBe('/landing/scrub-1920.webm')
    expect(chooseReelSource(true, false)).toBe('/landing/scrub-1920.webm')
  })
})

describe('trackHeight', () => {
  it('scales with duration plus one viewport', () => {
    expect(trackHeight(10, 900)).toBe(10 * REEL_SPS + 900)
  })
})

describe('expBlend', () => {
  it('is frame-rate independent: two 8ms steps ≈ one 16ms step', () => {
    const one = expBlend(0.016)
    const half = expBlend(0.008)
    const twoSteps = 1 - (1 - half) * (1 - half)
    expect(twoSteps).toBeCloseTo(one, 10)
  })
  it('clamps degenerate deltas', () => {
    expect(expBlend(0)).toBeGreaterThan(0)
    expect(expBlend(5)).toBeLessThan(1)
  })
})

describe('quantizeToFilmFrame', () => {
  it('lands on 30fps frame boundaries', () => {
    expect(quantizeToFilmFrame(1.47)).toBeCloseTo(44 / 30, 10)
    expect(quantizeToFilmFrame(0.016)).toBe(0)
  })
})
