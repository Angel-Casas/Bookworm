# Agent Self-Improvement Protocol

## Purpose
Create an objective feedback loop so the coding agent improves over time instead of drifting into bad habits.

## Principle
Improvement must be evidence-based, not vibe-based.

The agent should not simply say "done".
It should measure quality against a stable rubric.

## Operating loop
For each non-trivial task:

1. Predict risks before implementation
2. Implement the smallest clean solution
3. Score the result with the rubric below
4. Record evidence for each score
5. Identify one improvement for next time
6. Update recurring heuristics if a bug pattern appears

## Quality rubric
Score each dimension from 0 to 3.

### 1. Correctness
- 0 = likely broken or unverified
- 1 = works in happy path only
- 2 = works with key edge cases handled
- 3 = robust, validated, and failure-aware

### 2. Architectural fit
- 0 = violates project architecture
- 1 = partially aligned but leaky
- 2 = aligned with acceptable boundaries
- 3 = strongly aligned and improves structure

### 3. Type safety
- 0 = weak typing / unsafe boundary handling
- 1 = mixed quality
- 2 = strong typing with small gaps
- 3 = strong typing plus validated boundaries

### 4. Test adequacy
- 0 = no meaningful validation
- 1 = manual verification only
- 2 = useful tests for main risk
- 3 = tests match the actual failure surface

### 5. UX quality
- 0 = clumsy or inconsistent
- 1 = functional but rough
- 2 = coherent and usable
- 3 = polished, clear, and aligned with the design system

### 6. Accessibility
- 0 = ignored
- 1 = partial consideration
- 2 = basic support present
- 3 = deliberate accessible design

### 7. Performance awareness
- 0 = likely wasteful
- 1 = some awareness, weak execution
- 2 = avoids obvious issues
- 3 = efficient by design for the task size

### 8. Privacy / trust alignment
- 0 = violates trust expectations
- 1 = partially transparent
- 2 = acceptable and explicit
- 3 = strongly aligned with local-first transparency

### 9. Maintainability
- 0 = hard to understand or extend
- 1 = workable but messy
- 2 = readable and maintainable
- 3 = clean, modular, and future-proof enough

## Scoring rules
- maximum score: 27
- minimum passing score for a meaningful task: 19
- minimum passing score for a risky/core task: 22
- any score of 0 in Correctness, Architectural fit, Type safety, or Privacy/trust is an automatic fail
- if the task fails, the agent must revise before calling it complete

## Required self-review template
Use this after each meaningful task:

### Self-review scorecard
- Correctness: X/3
- Architectural fit: X/3
- Type safety: X/3
- Test adequacy: X/3
- UX quality: X/3
- Accessibility: X/3
- Performance awareness: X/3
- Privacy / trust alignment: X/3
- Maintainability: X/3

**Total:** X/27

### Evidence
- Correctness:
- Architectural fit:
- Type safety:
- Test adequacy:
- UX quality:
- Accessibility:
- Performance awareness:
- Privacy / trust alignment:
- Maintainability:

### Improvement for next task
- one concrete thing to do better next time

## Bad habit detectors
If any of the following appear, the agent must call them out explicitly:

- function too large without good reason
- component managing too many concerns
- duplicated logic
- weakly typed external data
- missing loading/error/empty states
- hidden side effects
- overuse of broad utility helpers
- unnecessary dependency introduction
- skipped accessibility checks
- skipped tests on high-risk logic
- vague naming
- documentation drift

## Root-cause protocol for defects
When a bug is discovered, do not only patch it.
Record:

1. Symptom
2. Root cause
3. Why it escaped
4. Which guardrail failed
5. New rule or test to prevent recurrence

## Continuous heuristics update
If the same failure pattern appears twice, convert it into a permanent heuristic.

Examples:
- "All parser outputs must be runtime-validated before normalization"
- "All context builders need token-budget tests"
- "All persisted entities need migration fixtures"
- "All reader actions need restoration-state checks"

## Definition of improvement
The agent is improving if:
- average rubric score rises over time
- repeated bug classes decline
- fewer fixes require rework
- architectural consistency increases
- tests align better with actual failures
- UI changes become more coherent and less noisy

## Final rule
Do not optimize for appearing productive.
Optimize for shipping trustworthy, maintainable, high-quality software.