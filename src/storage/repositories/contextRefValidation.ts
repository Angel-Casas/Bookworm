import type { ContextRef } from '@/domain';

// Phase 4.4 introduces a required `anchor: HighlightAnchor` on the passage
// variant of ContextRef and optional sectionTitle / windowBefore / windowAfter
// fields. Older 4.3 records never persisted passage refs (only 'open' mode
// shipped — pre-flight grep confirmed). This validator drops malformed
// passage refs but preserves the rest of the contextRefs array, matching the
// existing validating-reads spirit (more lenient than "drop the whole
// message", since a partial provenance is still useful).
//
// Other variants (highlight / chunk / section) keep their existing lenient
// pass-through behavior — the spec scopes the strictness change to the
// passage variant only.
export function isValidContextRef(value: unknown): value is ContextRef {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { kind?: unknown };
  if (v.kind === 'passage') {
    const p = v as Record<string, unknown>;
    if (typeof p.text !== 'string') return false;
    if (typeof p.anchor !== 'object' || p.anchor === null) return false;
    const a = p.anchor as { kind?: unknown };
    if (a.kind !== 'epub-cfi' && a.kind !== 'pdf') return false;
    if (p.sectionTitle !== undefined && typeof p.sectionTitle !== 'string') return false;
    if (p.windowBefore !== undefined && typeof p.windowBefore !== 'string') return false;
    if (p.windowAfter !== undefined && typeof p.windowAfter !== 'string') return false;
    return true;
  }
  if (v.kind === 'highlight' || v.kind === 'chunk' || v.kind === 'section') return true;
  return false;
}
