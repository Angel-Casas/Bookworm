# Agent Execution Playbook

## Purpose
Tell the coding agent exactly how to operate on this project.

## Default workflow
For every meaningful task, follow this sequence:

1. Understand the task
2. Restate the goal in plain language
3. Identify impacted modules
4. Identify risks and edge cases
5. Propose the smallest clean implementation
6. Implement
7. Validate
8. Self-review
9. Report clearly

## Required pre-implementation output
Before writing code, provide:
- task summary
- assumptions
- affected files
- risks
- test plan
- reasons for chosen approach
- reasons alternatives were rejected if relevant

## Scope discipline
- prefer the smallest coherent change
- do not refactor unrelated code without explaining why
- if the task reveals architecture debt, separate it into:
  - must-fix now
  - should-fix later

## Design discipline
- preserve the premium reading-first UX
- do not introduce generic placeholder UI
- keep visual changes consistent with `05-design-system.md`

## Architecture discipline
- keep domain logic out of UI components
- isolate side effects
- create adapters around third-party libraries
- avoid leaking library-specific details into the domain layer

## State discipline
- model important states explicitly
- avoid boolean soup
- avoid hidden mutable module state
- persist only what should persist

## AI discipline
- AI features must be transparent
- always show attached context in the UI
- never imply hidden whole-book understanding
- keep grounding and provenance visible

## Testing discipline
At minimum, the agent should state:
- what can break
- what was tested
- what remains untested
- what should get automated next

## When to stop and ask
Stop and ask instead of guessing when:
- requirements conflict
- architecture tradeoffs are large
- a new dependency seems necessary
- a task expands beyond its original scope
- data model changes are unclear
- parser behavior is uncertain
- UI intent is ambiguous

## Output format for completed tasks
Use this structure:

### Summary
Short explanation of what was done.

### Files changed
List files and their role.

### Key decisions
Important implementation choices.

### Risks / edge cases
What could still go wrong.

### Validation
What was tested.

### Follow-through
Any docs/tests/refactors still needed.

## Forbidden habits
- guessing hidden requirements
- large speculative rewrites
- mixing unrelated concerns
- introducing untyped boundary data
- adding dependencies casually
- skipping error states
- skipping accessibility considerations
- treating tests as optional
- replacing real design with generic AI-looking UI

## Preferred habits
- think first
- keep changes narrow
- name things clearly
- explain tradeoffs
- validate edge cases
- preserve architectural integrity
- leave the codebase cleaner than before