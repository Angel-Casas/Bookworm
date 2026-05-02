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

## Motion rules
- prefer opacity, transform, blur, scale
- avoid large bouncy motion
- keep durations short and calm
- preserve spatial continuity
- transitions should clarify structure

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