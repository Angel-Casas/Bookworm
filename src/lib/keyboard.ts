/** Pure predicates for keyboard-event routing. */

/**
 * Whether a key event's target is a text-entry element (input, textarea,
 * select, or contenteditable). Reader page-turn shortcuts must ignore these:
 * arrow keys there move the caret, not the book.
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const editableAttr = target.getAttribute('contenteditable')
  if (target.isContentEditable || editableAttr === '' || editableAttr === 'true') return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}
