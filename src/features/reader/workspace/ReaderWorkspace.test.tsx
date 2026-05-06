import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ReaderWorkspace } from './ReaderWorkspace';

afterEach(cleanup);

const fakeBookmarksRepo = {
  add: () => Promise.resolve(),
  patch: () => Promise.resolve(),
  delete: () => Promise.resolve(),
  listByBook: () => Promise.resolve([]),
  deleteByBook: () => Promise.resolve(),
};

const fakeHighlightsRepo = {
  add: () => Promise.resolve(),
  patch: () => Promise.resolve(),
  delete: () => Promise.resolve(),
  listByBook: () => Promise.resolve([]),
  deleteByBook: () => Promise.resolve(),
};

const fakeNotesRepo = {
  upsert: () => Promise.resolve(),
  delete: () => Promise.resolve(),
  listByBook: () => Promise.resolve([]),
  getByHighlight: () => Promise.resolve(null),
  deleteByHighlight: () => Promise.resolve(),
  deleteByBook: () => Promise.resolve(),
};

const baseProps = {
  bookId: 'b1',
  bookTitle: 'Test',
  bookFormat: 'epub' as const,
  onBack: () => undefined,
  loadBookForReader: () =>
    Promise.reject(new Error('test stub: loader not invoked in render-only checks')),
  createAdapter: () => {
    throw new Error('test stub: createAdapter not invoked in render-only checks');
  },
  onAnchorChange: () => undefined,
  onPreferencesChange: () => undefined,
  initialFocusMode: 'normal' as const,
  hasShownFirstTimeHint: true,
  onFocusModeChange: () => Promise.resolve(),
  onFirstTimeHintShown: () => undefined,
  bookmarksRepo: fakeBookmarksRepo,
  highlightsRepo: fakeHighlightsRepo,
  notesRepo: fakeNotesRepo,
  chatThreadsRepo: {
    upsert: () => Promise.resolve(),
    getById: () => Promise.resolve(null),
    listByBook: () => Promise.resolve([]),
    delete: () => Promise.resolve(),
    deleteByBook: () => Promise.resolve(),
  },
  chatMessagesRepo: {
    upsert: () => Promise.resolve(),
    getById: () => Promise.resolve(null),
    listByThread: () => Promise.resolve([]),
    delete: () => Promise.resolve(),
    deleteByThread: () => Promise.resolve(),
  },
  savedAnswersRepo: {
    upsert: () => Promise.resolve(),
    getById: () => Promise.resolve(null),
    getByMessage: () => Promise.resolve(null),
    listByBook: () => Promise.resolve([]),
    delete: () => Promise.resolve(),
    deleteByBook: () => Promise.resolve(),
  },
  onOpenNotebook: () => undefined,
  onOpenSettings: () => undefined,
  initialRightRailVisible: true,
  onRightRailVisibilityChange: () => undefined,
  initialChatPanelHintShown: false,
  onChatPanelHintDismiss: () => undefined,
  apiKeyState: { kind: 'none' as const },
  getApiKey: () => null,
  selectedModelId: null,
  bookChunksRepo: {
    upsertMany: () => Promise.resolve(),
    listByBook: () => Promise.resolve([]),
    listBySection: () => Promise.resolve([]),
    deleteByBook: () => Promise.resolve(),
    deleteBySection: () => Promise.resolve(),
    countByBook: () => Promise.resolve(0),
    countStaleVersions: () => Promise.resolve([]),
    hasChunksFor: () => Promise.resolve(false),
  },
  bookEmbeddingsRepo: {
    upsertMany: () => Promise.resolve(),
    listByBook: () => Promise.resolve([]),
    deleteByBook: () => Promise.resolve(),
    countByBook: () => Promise.resolve(0),
    hasEmbeddingFor: () => Promise.resolve(false),
    countStaleVersions: () => Promise.resolve([]),
    deleteOrphans: () => Promise.resolve(0),
  },
};

describe('ReaderWorkspace (smoke)', () => {
  it('mounts with chrome visible in normal mode', () => {
    render(<ReaderWorkspace {...baseProps} />);
    expect(screen.getByLabelText('Back to library')).toBeDefined();
    expect(document.querySelector('.reader-workspace')).not.toBeNull();
  });

  it('respects initialFocusMode=focus → chrome hidden, focus mode applied', () => {
    render(<ReaderWorkspace {...baseProps} initialFocusMode="focus" />);
    expect(document.querySelector('.reader-workspace')?.getAttribute('data-mode')).toBe('focus');
    expect(screen.queryByLabelText('Back to library')).toBeNull();
  });
});
