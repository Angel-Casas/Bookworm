import { describe, expect, it } from 'vitest'
import { sectionLabel } from '../sectionLabel'

describe('sectionLabel', () => {
  it('uses the chapter’s own title', () => {
    expect(sectionLabel(['The Lamp at the Threshold'], 3)).toBe('The Lamp at the Threshold')
  })

  it('keeps a numbered title whole — it reads as a place', () => {
    expect(sectionLabel(['Chapter 4: The Lamp'], 3)).toBe('Chapter 4: The Lamp')
  })

  it('falls back to the number when the heading only repeats it', () => {
    expect(sectionLabel(['Chapter 4'], 3)).toBe('Section 4')
    expect(sectionLabel(['IV.'], 3)).toBe('Section 4')
    expect(sectionLabel(['7'], 6)).toBe('Section 7')
  })

  it('skips front matter that names itself', () => {
    expect(sectionLabel(['Contents'], 0)).toBe('Section 1')
    expect(sectionLabel(['Copyright'], 1)).toBe('Section 2')
  })

  it('takes the first usable heading, not the first heading', () => {
    expect(sectionLabel(['Chapter 2', 'The Long Road'], 1)).toBe('The Long Road')
  })

  it('refuses a heading too long to be a label', () => {
    expect(sectionLabel(['x'.repeat(80)], 0)).toBe('Section 1')
  })

  it('tidies whitespace the markup left behind', () => {
    expect(sectionLabel(['  The\n  Lamp  '], 0)).toBe('The Lamp')
  })

  it('falls back when there are no headings at all', () => {
    expect(sectionLabel([], 11)).toBe('Section 12')
    expect(sectionLabel(['', '   '], 0)).toBe('Section 1')
  })
})
