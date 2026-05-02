# Quality Strategy

## Purpose
Define how we prevent bugs, preserve maintainability, and avoid gradual quality decay.

## Quality philosophy
We do not rely on cleanup later.
We build with quality constraints from the start.

The main strategy is:
- pure domain logic
- explicit boundaries
- strict typing
- runtime validation at edges
- narrow module responsibilities
- tests for critical logic
- disciplined review standards

## Architectural quality rules
### Rule 1 — Functional core, imperative shell
Pure logic belongs in domain modules.
Side effects belong in adapters/services/hooks.

### Rule 2 — Domain first
Do not bury business logic inside UI components.

### Rule 3 — Typed boundaries
All external inputs must be validated:
- file parser results
- persisted data
- API responses
- query params
- local settings
- migrations

### Rule 4 — Explicit states
Use discriminated unions / state machines for:
- import flow
- indexing flow
- chat request states
- reader load states
- persistence/migration states

### Rule 5 — No invisible magic
If behavior matters, it must be traceable.

## Coding standards
- TypeScript strict mode
- avoid `any`
- avoid large god-components
- avoid duplicated logic
- prefer small pure helpers
- prefer composition over inheritance
- use exhaustive switching where possible
- no unowned TODOs
- no mystery booleans without semantic naming

## File and complexity heuristics
### Warning thresholds
- file > 300 lines
- component > 200 lines
- function > 40 lines
- more than 3 nested conditions
- more than 3 responsibilities in one module

### Hard-stop thresholds unless justified
- file > 500 lines
- component > 300 lines
- function > 70 lines
- repeated logic copied 3+ times
- broad utility modules with unclear ownership

## Testing strategy
### Unit tests
Must cover:
- chunking
- token estimation
- prompt assembly
- reducers
- selectors
- migrations
- anchor normalization
- retrieval ranking logic

### Integration tests
Must cover:
- import flows
- persistence restore
- reader open/close
- annotation creation
- AI request creation
- error recovery

### End-to-end tests
Must cover:
- install app
- import a book
- read and annotate
- ask AI with context
- reload and recover state

## Golden fixtures
Maintain a fixed test library containing:
- small EPUB
- large EPUB
- text-friendly PDF
- complex-layout PDF
- malformed file
- weird TOC file

Rules:
- fixtures are versioned
- fixture changes require explanation
- no silent replacement of test assets

## Error handling standards
Every async feature must define:
- loading state
- empty state
- success state
- recoverable error state
- non-recoverable error state
- retry path if meaningful

## Data safety standards
- migrations are explicit
- destructive actions require confirmation or undo
- parser failures must not corrupt existing data
- partial imports must not appear as successful imports
- user data must not be silently discarded

## Performance standards
- no expensive work in render paths
- debounce search/index updates where appropriate
- use background processing where possible
- lazy-load heavy subsystems
- measure before "optimizing"

## Accessibility standards
- keyboard usable
- visible focus
- semantic structure
- reduced motion respected
- screen-reader labels for critical actions

## Review checklist
Before merging, confirm:
- purpose is clear
- module boundaries are respected
- types are strong
- edge cases are handled
- tests match risk
- empty/error/loading states exist
- privacy implications were considered
- docs updated if behavior changed

## Quality gate
A change is not complete unless:
- it works
- it is understandable
- it is testable
- it is maintainable
- it does not lower the architecture standard