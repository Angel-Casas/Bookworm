import { test } from '@playwright/test';

// Phase 4.4 mobile passage-mode coverage.
//
// The full mobile flow is:
//   1. Mobile viewport → select text in the reader
//   2. Tap Ask AI in the highlight toolbar
//   3. Mobile sheet auto-opens to the new "Chat" tab (4th tab)
//   4. Chip appears with the selection; composer auto-focuses
//   5. Send → answer streams → close sheet → reopen → answer preserved across
//      the chat-tab unmount (chip is intentionally transient — spec §14)
//
// The selection-→-Ask-AI-→-chip-on-mobile-sheet portion is mockable today
// (no streaming required), but mobile selection in foliate-view's iframe is
// unreliable in the existing Playwright setup — the touch/contextmenu
// gesture path differs from desktop's range API, and the toolbar position
// math depends on the mobile sheet not occluding the selection.
//
// The send-and-preserve portion additionally needs the SSE mock harness
// (see chat-passage-mode-desktop.spec.ts TODO).
//
// Coverage of the underlying logic exists in:
//   - PassageChip.test.tsx (chip rendering, dismiss)
//   - useChatSend.test.ts (passage-mode prompt + contextRef asymmetry)
//   - ReaderWorkspace's wiring (selection bridge, sheet auto-switch) is
//     exercised by manual smoke per spec §16
//
// Deferred until: (a) SSE mock harness, (b) reliable iframe selection in
// mobile viewport.
test.skip('TODO mobile passage-mode end-to-end (needs iframe selection + SSE mock)', () => {
  // Implementation deferred — see file-level comment.
});
