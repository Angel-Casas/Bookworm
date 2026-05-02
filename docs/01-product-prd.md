# Product PRD

## Project name
Bookworm

## One-line product definition
A premium PWA that lets users import books, read comfortably, annotate deeply, and talk to AI models grounded in the actual content of those books.

## Problem
Readers can store and read books in many apps, and they can talk to LLMs in many apps, but very few tools let them:
- keep books local
- annotate naturally
- attach precise book context to AI conversations
- inspect what context is being sent
- revisit answers linked back to real passages

This gap is especially painful for:
- serious readers
- students
- researchers
- nonfiction readers
- fantasy/sci-fi readers tracking entities and relationships
- technical readers studying dense material

## Target users
### Primary
- Curious readers who want to ask books questions
- Students who want study help grounded in actual chapters
- Power readers who highlight and annotate heavily

### Secondary
- Researchers and knowledge workers
- Teachers and tutors
- Book-club readers
- Readers of technical, historical, philosophical, or academic content

## Core value proposition
The user can:
1. import a book
2. read and annotate it
3. select the exact context they want
4. ask an LLM grounded questions
5. receive answers tied back to the source passages
6. build a reusable thinking layer around the book

## Product principles
1. Reading comes first
2. AI must support reading, not replace it
3. Local-first by default
4. Privacy and transparency are visible features
5. The UI should feel premium, calm, and trustworthy
6. Explicit context is better than hidden automation
7. Retrieval beats naive "send the whole book"
8. v1 must be narrow enough to ship polished

## v1 goals
- Installable PWA
- Local library/bookshelf
- EPUB reading
- PDF reading
- Bookmarks
- Highlights
- Notes
- AI chat using user NanoGPT API key
- Context picker:
  - selected text
  - current chapter
  - multiple highlights
  - retrieval from the whole book
- Suggested prompts
- Offline reading after import
- Restore library and reading state after app restart

## v1 non-goals
- Backend
- Cloud sync
- Social features
- Real-time collaboration
- OCR for scanned PDFs
- Perfect support for every ebook format
- Complex agent automation inside the app
- Advanced study exports in the first release
- Audio/TTS in v1

## Format strategy
### First-class
- EPUB
- PDF

### Deferred / experimental
- MOBI

Rationale:
- EPUB and PDF have the clearest browser-side rendering path
- They cover the highest-value early use cases
- Deferring MOBI reduces parser complexity and protects product quality

## Key user stories
### Library
- As a user, I can import books and see them as visually rich covers in a bookshelf
- As a user, I can resume the last book where I left off
- As a user, I can filter or sort my library

### Reading
- As a user, I can read EPUB comfortably with typography controls
- As a user, I can read PDF with strong page navigation and selection
- As a user, I can bookmark locations
- As a user, I can highlight and annotate passages
- As a user, I can jump from note to source passage

### AI
- As a user, I can add my NanoGPT API key
- As a user, I can choose an available model
- As a user, I can ask about a selected passage
- As a user, I can ask about a chapter
- As a user, I can ask about a whole book using retrieval
- As a user, I can see exactly what context will be sent
- As a user, I can review the evidence used in the answer
- As a user, I can save AI output as notes

### Discovery / guidance
- As a user, I can get suggested prompts tailored to the book
- As a user, I can get different prompt styles:
  - comprehension
  - analysis
  - structure mapping
  - creative exploration
  - study support

## UX requirements
- The app must feel calm and premium
- The main reader area must remain visually dominant
- AI must not overwhelm the reading experience
- Transitions should be polished and subtle
- Important actions must be reversible
- Empty states must feel intentional, not unfinished

## Trust requirements
- The app must show what content leaves the device
- The app must never silently upload books
- The app must make API-key handling explicit
- The app must show context size/cost estimates where possible
- The app must show source passages for grounded answers

## Success criteria for v1
- User can import EPUB/PDF
- User can read offline after import
- User can create bookmarks/highlights/notes
- User can attach context to a chat request
- User can get an answer with visible source passages
- User can reopen the app and keep their library/state
- The app feels intentionally designed, not prototype-like

## Failure criteria
- AI feels generic and disconnected from the text
- Reader UX feels secondary to chat UX
- Importing books is unreliable
- State is lost too easily
- Costs/tokens are opaque
- The interface feels cluttered or cheap
- Too many formats/features are attempted at once

## Decision history
### Initial decisions
- Frontend-only
- Local-first
- BYOK for NanoGPT
- EPUB/PDF first
- Retrieval-first AI context strategy
- Premium minimal UI over dashboard-heavy UI

### 2026-05-02 — Phase 0 alignment
- Project named "Bookworm"
- Detailed stack and architecture decisions locked in `02-system-architecture.md`