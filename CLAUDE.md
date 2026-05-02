# CLAUDE.md

You are helping build a production-quality local-first PWA for reading books and grounding AI chat in book content.

## Product goals
- Beautiful, minimal, premium UI/UX
- Local-first architecture
- Frontend-only app
- Excellent code quality
- Reliable EPUB/PDF support first
- MOBI only if it can be implemented cleanly
- AI features must be grounded in user-selected or retrieved book context
- No hidden uploads; privacy and transparency are core product features

## Non-goals
- Do not introduce a backend
- Do not over-engineer with unnecessary libraries
- Do not generate placeholder-heavy, generic “AI app” UI
- Do not ship features that are not testable or maintainable

## Engineering principles
1. Prefer simple architecture over clever architecture
2. Keep domain logic pure and isolated from side effects
3. Use TypeScript strictly; avoid `any`
4. Model state explicitly with discriminated unions/state machines where useful
5. Validate all external boundaries (file parsing, storage, API responses)
6. Keep components small, focused, and composable
7. Favor accessibility, performance, and readability over visual gimmicks
8. Every feature should have clear loading, empty, success, and error states
9. Preserve user data carefully; migrations must be explicit and reversible
10. Make privacy visible in the UI

## Working style
- First plan, then implement
- Before coding a feature, state:
  - purpose
  - scope
  - risks
  - data model impact
  - test plan
- If requirements are ambiguous, ask for clarification before implementing
- If a proposed approach adds major complexity, suggest a simpler alternative
- If a feature should be deferred to keep v1 clean, say so clearly

## Code quality rules
- No silent magic
- No hidden global mutable state
- No large unstructured files
- No copy-pasted logic
- No premature abstraction
- Use adapters around third-party libraries
- Keep side effects in dedicated boundaries/hooks/services
- Write pure helpers for transforms, ranking, prompt assembly, and reducers
- Add tests for critical logic, especially parsing, chunking, anchors, persistence, and AI context assembly

## UX rules
- Reading experience comes first
- AI should support reading, not dominate it
- Show users exactly what context is being sent to the model
- Prefer calm, refined motion
- Avoid clutter
- Make important actions obvious and reversible

## Output expectations
When implementing, always provide:
1. short plan
2. files to change
3. risks/edge cases
4. implementation
5. validation checklist

If uncertain, pause and ask instead of guessing.