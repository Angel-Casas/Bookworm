# Design System

## Design intent
The product should feel like a premium reading desk:
- calm
- tactile
- elegant
- focused
- trustworthy

Not:
- noisy
- neon
- dashboard-heavy
- gimmicky
- "AI startup template"

## Visual keywords
- paper
- ink
- walnut
- smoke
- brass
- glass
- velvet shadow
- quiet motion

## UX principles
1. Reading surface is the primary canvas
2. Motion supports comprehension, not attention theft
3. The interface should reward return visits
4. Density should feel curated, not empty and not crowded
5. AI controls should be discoverable but secondary
6. Visual hierarchy must remain stable across the app

## Layout principles
### Desktop
- three-pane workspace by default — left rail, reader, right rail
- all three panels visible by default
- each panel can be individually maximized; reader can run in focus/single-pane mode
- central reading pane remains dominant when all panels are visible
- side panels should collapse elegantly
- no panel should feel like dead chrome

### Mobile
- single-focus reading
- slide-up sheets for secondary tools
- bottom controls only for high-frequency actions
- avoid tiny icon overload

## Color philosophy
Use a restrained palette with a strong neutral foundation.

### Suggested palette roles
- background / app shell
- reading surface
- elevated panel
- muted text
- primary text
- accent
- success
- warning
- danger
- highlight colors

### Tone guidance
- dark mode should be rich, not pitch-black
- light mode should be soft, not sterile white
- highlights should be tasteful and readable
- accent color should feel literary, not corporate SaaS

## Typography
### Principles
- typography is part of the product identity
- reading font and UI font can differ
- line length and line height matter more than visual tricks

### Reader controls
- reading font family
- font size
- line height
- column width / margins
- theme mode
- scroll or pagination — mobile defaults to pagination, desktop defaults to scroll; user choice is persisted per format (EPUB/PDF)

## Component list
### Core components
- App frame
- Bookshelf grid
- Book card
- Progress ring
- Reader pane
- Left rail
- Right rail
- Bottom sheet
- Context chip
- Source card
- Note card
- AI message bubble
- Model chip
- Token/cost hint
- Prompt suggestion card
- Empty state panel
- Error state panel

## Motion

### Principles
- Prefer opacity, transform, blur, scale.
- Calm and refined; avoid bouncy or attention-stealing motion.
- Keep durations short and on-token.
- Motion clarifies structure and supports comprehension; it never decorates.
- Reduced motion is honored automatically — see below.

### Tokens
Durations (defined in `src/design-system/tokens.css`):
- `--duration-fast` 120ms — instant feedback (hover background, focus ring tint)
- `--duration-base` 200ms — standard affordance (press, scrim fade, plain fade-in)
- `--duration-slow` 320ms — considered surface change (sheet, modal, toast, pulse)
- `--duration-slower` 480ms — one-shot reveal (empty-state, drop-overlay)

Curves (defined in `src/design-system/tokens.css`):
- `--ease-out` — default. Hover, press, fade, rise, scrim, pulse, transitions.
- `--ease-in-out` — infinite loops only (typing caret, future skeleton shimmer).
- `--ease-spring` — exclusively for focal arrivals (sheet, modal, toast).

### Primitives (`src/design-system/motion.css`)
Apply via utility class. Do not redeclare these keyframes in feature CSS.

| Class | Effect | Duration / Curve |
|---|---|---|
| `.motion-fade-in` | opacity 0→1 | base / out |
| `.motion-rise` | translateY(8px) + opacity | slower / out |
| `.motion-sheet-in` | translateY(100%) → 0 | slow / spring |
| `.motion-scrim-in` | opacity 0→1 (backdrop) | base / out |
| `.motion-toast-in` | translateY(-8px) + opacity | slow / spring |
| `.motion-pulse` | scale 1 → 1.04 → 1 | slow / out |
| `.motion-rule-grow` | scaleX 0 → 1 (origin: left) | slower / out |
| `.motion-breath` | opacity loop, infinite | base × 7 / in-out |

### Hover and press canon
Hover and press are documented declarations rather than keyframes. Helper classes are provided in `motion.css`; an inline declaration that uses the same tokens is equally valid.

- Hover (`.motion-hover-bg`): `transition: background var(--duration-fast) var(--ease-out);`
- Press (`.motion-press`): `transition: transform var(--duration-base) var(--ease-out);` paired with `:active { transform: scale(0.98); }` where pressable.

The rule is the tokens, not the class.

### Stagger pattern
When several primitives land together, apply `animation-delay` in token-multiples:

```css
.empty-item:nth-child(2) { animation-delay: calc(var(--duration-fast) * 1); }
.empty-item:nth-child(3) { animation-delay: calc(var(--duration-fast) * 2); }
```

Token-multiples zero correctly under reduced-motion because the underlying token zeroes.

### View Transitions
Cross-surface transitions (library↔reader, panel open/close, modal open/close, notebook open) use the View Transitions API via `useViewTransition` in `src/shared/motion/`. Names live in `viewTransitionNames.ts`. Per-instance names (e.g. a specific book card) are built with the `libraryCardViewTransitionName` helper. Only the outermost modal in z-order should claim `modal-root`.

### Reduced motion
The single source of truth is `tokens.css`: under `prefers-reduced-motion: reduce` all four `--duration-*` tokens become `0ms`. Any animation built on tokens — including primitives, helper classes, hover/press, and `animation-delay` token-multiples — is automatically suppressed. Authors do **not** need to write per-component `@media` overrides. The `useViewTransition` hook performs an analogous check and runs the updater synchronously, because the View Transitions API does not auto-honor reduced-motion when timing is customized.

### Do / Don't
- Do reach for tokens or primitives. Do not write literal `ms` or `cubic-bezier(...)` values.
- Do use `--ease-spring` only for focal arrivals (sheet, modal, toast). Default to `--ease-out`.
- Do remove redundant `@media (prefers-reduced-motion: reduce) { animation: none; }` blocks once a surface is fully tokenized.
- Don't add JS-driven physics or third-party motion libraries.
- Don't over-animate. The product should feel calm in regular motion mode.

## Interaction details
### Bookshelf
- cover hover lift
- progress reveal
- subtle shelf depth
- last-opened emphasis
- selection clarity

### Reader
- page/location transitions should feel stable
- selection affordances must be crisp
- note/highlight creation should feel instant
- panels should not disrupt reading position

### AI panel
- context chips should be visible before send
- source cards should feel inspectable
- "jump to source" must be obvious
- save-as-note should be one clean action

## Accessibility rules
- all contrast must be intentional
- keyboard navigation is required
- focus states must be elegant but obvious
- touch targets must be comfortable
- motion must respect reduced-motion preferences

## Anti-patterns
- giant empty dashboards
- generic chat-homepage hero layouts
- glowing AI orbs
- overuse of gradients
- overloaded icon-only controls
- cramped reader margins
- noisy card borders everywhere

## Definition of visual success
The UI should make a user think:
- "This feels made for reading"
- "This feels trustworthy"
- "This feels polished"
- "I want to come back to this app"