import { test } from '@playwright/test';

// Phase 4.4 notebook jump-from-passage coverage.
//
// The full flow is:
//   1. Configure key + model
//   2. Open book → select text → Ask AI → send a question
//   3. Save the assistant's answer with a note
//   4. Open the notebook → AI answers filter → tap "Jump to passage"
//   5. Reader navigates to the saved passage anchor
//
// Steps 2-3 require the SSE mock harness (see chat-passage-mode-desktop.spec
// TODO comment for the open question on streaming the /api/v1/chat/completions
// endpoint).
//
// Coverage of the underlying logic exists in:
//   - NotebookRow.test.tsx (savedAnswer Jump-to-passage button rendering +
//     click → onJumpToAnchor with the projected LocationAnchor; locks the
//     .find() pattern for forward compat with multi-source modes)
//   - useChatSend.test.ts (passage contextRefs persisted on assistant only)
//   - Storage validators (chatMessages.test.ts + savedAnswers.test.ts)
//     round-trip the passage variant correctly
//
// Manual smoke required for the full notebook jump-back flow before declaring
// 4.4 complete (see spec §16 validation checklist).
//
// Deferred until: SSE mock harness exists.
test.skip('TODO save passage answer → notebook → jump to passage (needs SSE mock harness)', () => {
  // Implementation deferred — see file-level comment.
});
