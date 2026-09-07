import { describe, expect, it } from 'vitest'
import { isTextEntryTarget } from '../keyboard'

describe('isTextEntryTarget', () => {
  it('detects text-entry elements', () => {
    expect(isTextEntryTarget(document.createElement('input'))).toBe(true)
    expect(isTextEntryTarget(document.createElement('textarea'))).toBe(true)
    expect(isTextEntryTarget(document.createElement('select'))).toBe(true)
  })
  it('detects contenteditable', () => {
    const div = document.createElement('div')
    div.setAttribute('contenteditable', 'true')
    expect(isTextEntryTarget(div)).toBe(true)
    const implicit = document.createElement('div')
    implicit.setAttribute('contenteditable', '')
    expect(isTextEntryTarget(implicit)).toBe(true)
  })
  it('rejects ordinary elements and null', () => {
    expect(isTextEntryTarget(document.createElement('div'))).toBe(false)
    expect(isTextEntryTarget(document.body)).toBe(false)
    expect(isTextEntryTarget(null)).toBe(false)
  })
})
