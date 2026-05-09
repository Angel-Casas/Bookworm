# Empty / loading / error / success state matrix

Living document. Every user-facing surface in the app, with a presence
check for each canonical state. Initially empty; filled in during the
Phase 6 audit (PR-C); kept current as new surfaces are added.

## Surfaces examined

(per `docs/superpowers/specs/2026-05-09-phase-6-audit-design.md` §3.5)

Library, Library import (DropOverlay + ImportTray), BookCard (and its menu),
Reader (EPUB + PDF), TocPanel, HighlightsPanel, BookmarksPanel, NoteEditor,
IndexInspectorModal, Chat thread list, ChatPanel, PrivacyPreview,
SuggestedPrompts, multi-excerpt tray, Settings.

## Matrix

| Surface | Loading | Empty | Success | Error | Notes |
|---------|---------|-------|---------|-------|-------|
| _empty — fill in PR-C_ | | | | | |

## ErrorBoundary placement recommendation

_To be written in PR-C after surveying `src/app/App.tsx` render tree._
