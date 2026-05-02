# Docs Index

This folder is the operating manual for the project.

## Reading order
1. `01-product-prd.md`
2. `02-system-architecture.md`
3. `03-ai-context-engine.md`
4. `04-implementation-roadmap.md`
5. `05-design-system.md`
6. `06-quality-strategy.md`
7. `07-agent-execution-playbook.md`
8. `08-agent-self-improvement.md`

## Project summary
We are building a local-first PWA for reading books and grounding AI chat in book content.

Core capabilities:
- Import and read books
- Maintain a local library with beautiful bookshelf UI
- EPUB and PDF first; MOBI deferred unless implementation quality is high
- Bookmarks, highlights, notes
- AI chat grounded in user-selected or retrieved book context
- Suggested prompts generated from book structure/content
- Frontend-only architecture
- User-provided NanoGPT API key
- Privacy-first UX with explicit context visibility

## Product philosophy
This is not "just an ebook reader" and not "just an AI chat app".

It is:
- a reading workspace
- a thinking tool
- a local-first knowledge instrument
- a premium-feeling app with calm, high-quality UX

## Non-negotiables
- No backend in v1
- No hidden uploads
- No generic low-quality AI UI
- No magic architecture
- No poor test discipline
- No feature sprawl that harms the reading experience

## Documentation maintenance rules
- Keep docs aligned with implementation reality
- If architecture changes, update the relevant doc in the same PR
- If a decision is reversed, preserve the old decision in a short "Decision History" section
- Add dates to meaningful changes
- Prefer short, concrete, falsifiable language over vague aspirations