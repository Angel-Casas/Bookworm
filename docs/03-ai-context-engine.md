# AI Context Engine

## Purpose
Define how AI works in the product without degrading reading quality, privacy, or cost control.

## Core rule
Never default to "send the whole book".

Default to:
- user-selected context
- chapter context
- multi-excerpt context
- retrieval from normalized chunks

## AI goals
- answer questions about a selected passage
- answer questions about a chapter
- answer questions about multiple excerpts
- support whole-book Q&A through retrieval
- generate high-quality prompt suggestions
- provide visible source provenance
- reduce unnecessary token waste

## AI operating modes
### 1. Passage mode
Use when the user selects text directly.

Context payload:
- exact selected passage
- nearby paragraph window if useful
- anchor metadata
- optional book title / chapter title

Best for:
- explain this passage
- paraphrase this
- define terms
- connect this to nearby content

### 2. Chapter mode
Use when user asks about current chapter.

Context payload:
- chapter title
- chapter summary if available
- top chunks from current chapter
- relevant highlights/notes in chapter

Best for:
- summarize chapter
- identify main arguments
- list important events
- explain chapter structure

### 3. Multi-excerpt mode
Use when user manually selects several passages.

Context payload:
- ordered selected excerpts
- labels for each excerpt
- optional user instruction describing comparison goal

Best for:
- compare themes
- trace character development
- collect evidence
- connect recurring concepts

### 4. Retrieval mode
Use when user asks about the whole book or a broad topic.

Pipeline:
1. normalize question
2. search chunks by keyword + semantic retrieval
3. rank candidate chunks
4. assemble top evidence set
5. estimate token budget
6. send only the best chunk bundle
7. present answer with evidence references

Best for:
- where is this idea discussed
- who are the main factions
- map the main concepts
- explain how chapters connect

### 5. Full-book attach mode
Only allow when:
- the estimated token count fits the selected model context window
- the user explicitly opts in
- the UI warns about likely cost/latency
- the book is reasonably sized or summarized first

This is not default behavior.

## Model strategy
### Model discovery
NanoGPT is assumed OpenAI-compatible (`/v1/models`, `/v1/chat/completions`, `/v1/embeddings`). See `02-system-architecture.md` for the integration contract.

At settings or startup after key entry:
- fetch available text models
- fetch detailed model metadata when needed
- store a local model catalog snapshot
- expose model name, provider, context length, capabilities, and pricing hints in the UI
- map "Fast / Balanced / Deep" presets to live catalog entries (no hardcoded model IDs)

### User-facing AI modes
Do not expose raw complexity first.
Use simple presets:
- Fast
- Balanced
- Deep

Map those presets to internal model and parameter choices.

## Context budgeting
Before every request:
- estimate tokens for user query
- estimate tokens for context bundle
- reserve completion budget
- if too large:
  - trim context
  - summarize large pieces
  - fall back to retrieval
  - warn the user when necessary

## Prompt assembly rules
Every prompt should include:
- role framing
- answer style instruction
- grounding instruction
- evidence boundaries
- selected context bundle
- desired output mode

### Grounding instruction pattern
The model should be told to:
- prioritize provided book context
- distinguish between evidence from the book and outside knowledge
- say when the evidence is insufficient
- avoid fabricating chapter facts not supported by context

## Answer modes
### Strict grounded
- Answer only from provided book context
- If insufficient evidence, say so plainly

### Grounded plus general knowledge
- Use provided context first
- Allow external knowledge when helpful
- Label outside knowledge explicitly

### Open discussion
- Freer exploratory mode
- Still show what book context was attached

## Suggested prompts system
### Goal
Generate prompts that feel specific to the book, not generic.

### Inputs
- title
- author
- table of contents
- sampled excerpts
- chapter openings/closings
- extracted entities/concepts
- genre hints
- user reading mode if available

### Output categories
- comprehension
- analysis
- structure
- creative exploration
- study support

### Fiction examples
- Track the evolving motives of key characters
- Build a relationship map between families/factions
- Identify scenes that foreshadow later events
- Reconstruct a timeline of major turning points

### Nonfiction examples
- Map the central claims and supporting arguments
- Identify the key terms and define them
- Show the dependency structure between chapters
- List objections or tensions inside the text

### Textbook / technical examples
- Build a prerequisite map
- Show how concepts depend on one another
- Create a mini glossary
- Suggest likely exam questions
- Connect definitions, examples, and theorems

## Structured outputs
Use schema-constrained outputs for:
- prompt suggestions
- concept graphs
- family trees
- timelines
- glossary entries
- chapter profiles
- study cards

## Embeddings strategy
Use embeddings for:
- semantic retrieval
- related highlights
- concept clustering
- prompt suggestion relevance
- whole-book Q&A support

### Local embedding policy
- compute embeddings through NanoGPT
- store vectors locally
- do similarity search locally
- avoid re-embedding unchanged chunks

## Prompt caching strategy
Prompt caching is valuable when users ask multiple follow-up questions about the same chapter or evidence bundle.

### Implementation
Use provider-style cache breakpoints (NanoGPT/Anthropic-compatible). Place breakpoints at stable prefix boundaries, ordered most-stable to least-stable:
1. system instructions
2. book profile (title/author/summary/genre)
3. chapter or retrieval-evidence bundle
4. variable user turn (uncached)

Caching should be considered for:
- stable chapter context
- long system instructions
- repeated book profiles
- repeated retrieval prefixes in the same thread

The UI does not need to expose all low-level mechanics, but can surface:
- cached context
- reused context
- token savings hints

## Provenance requirements
Every grounded answer should support:
- source excerpt cards
- jump-to-passage action
- visible context chips
- saved provenance in chat history

## Failure handling
When AI fails:
- preserve the user question draft
- show the exact failed model
- show whether the failure happened before or after send
- offer retry with same context
- offer retry with smaller context
- offer switch model

## Safety and honesty rules
- Never imply the model has read the entire book unless it actually received it or retrieval covered relevant evidence
- Never hide that content is being sent to a third-party model
- Never show AI output as if it were a verified annotation
- Clearly separate user notes from AI-generated content