/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ModelsSection } from './ModelsSection';
import { useModelCatalogStore } from './modelCatalogStore';
import type { SettingsRepository } from '@/storage';
import type { ModelsFetchResult } from '@/features/ai/key/nanogptApi';

afterEach(cleanup);

beforeEach(() => {
  useModelCatalogStore.getState().reset();
});

function fakeRepo(): SettingsRepository {
  return {
    getLibrarySort: vi.fn(() => Promise.resolve(undefined)),
    setLibrarySort: vi.fn(() => Promise.resolve()),
    getStoragePersistResult: vi.fn(() => Promise.resolve(undefined)),
    setStoragePersistResult: vi.fn(() => Promise.resolve()),
    getView: vi.fn(() => Promise.resolve(undefined)),
    setView: vi.fn(() => Promise.resolve()),
    getFocusModeHintShown: vi.fn(() => Promise.resolve(false)),
    setFocusModeHintShown: vi.fn(() => Promise.resolve()),
    getApiKeyBlob: vi.fn(() => Promise.resolve(undefined)),
    putApiKeyBlob: vi.fn(() => Promise.resolve()),
    deleteApiKeyBlob: vi.fn(() => Promise.resolve()),
    getModelCatalog: vi.fn(() => Promise.resolve(undefined)),
    putModelCatalog: vi.fn(() => Promise.resolve()),
    deleteModelCatalog: vi.fn(() => Promise.resolve()),
    getSelectedModelId: vi.fn(() => Promise.resolve(undefined)),
    putSelectedModelId: vi.fn(() => Promise.resolve()),
    deleteSelectedModelId: vi.fn(() => Promise.resolve()),
  };
}

function setup(opts: {
  readonly fetchResult?: ModelsFetchResult;
  readonly apiKey?: string;
}) {
  const repo = fakeRepo();
  const fetchCatalog = vi.fn(() =>
    Promise.resolve(opts.fetchResult ?? { ok: true as const, models: [] }),
  );
  return {
    repo,
    fetchCatalog,
    rendered: render(
      <ModelsSection
        settingsRepo={repo}
        fetchCatalog={fetchCatalog}
        getApiKey={() => opts.apiKey ?? 'sk-test'}
      />,
    ),
  };
}

describe('ModelsSection', () => {
  it('renders idle copy + enabled refresh in idle state', () => {
    setup({});
    expect(screen.getByText(/refresh to load available models/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /refresh/i })).toBeEnabled();
  });

  it('refresh-click triggers fetch and transitions to ready', async () => {
    const { fetchCatalog, repo } = setup({
      fetchResult: { ok: true, models: [{ id: 'm-1' }, { id: 'm-2' }] },
    });
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    await waitFor(() => {
      expect(useModelCatalogStore.getState().state.kind).toBe('ready');
    });
    expect(fetchCatalog).toHaveBeenCalledWith('sk-test');
    expect(repo.putModelCatalog).toHaveBeenCalled();
    expect(screen.getByText('m-1')).toBeInTheDocument();
    expect(screen.getByText('m-2')).toBeInTheDocument();
  });

  it('shows empty state when ready with 0 models', () => {
    useModelCatalogStore.getState().setReady([], 1);
    setup({});
    expect(screen.getByText(/returned no models/i)).toBeInTheDocument();
  });

  it('shows full error state with no cache', () => {
    useModelCatalogStore.getState().setError('network');
    setup({});
    expect(screen.getByText(/couldn['’]t reach nanogpt/i)).toBeInTheDocument();
  });

  it('shows list + inline banner on cached error', () => {
    useModelCatalogStore.getState().setReady([{ id: 'cached-1' }], Date.now() - 60_000);
    useModelCatalogStore.getState().setRefreshFailureWithCache('network');
    setup({});
    expect(screen.getByText('cached-1')).toBeInTheDocument();
    expect(screen.getByText(/last-known list/i)).toBeInTheDocument();
  });

  it('selection-click persists + clears any stale notice', async () => {
    useModelCatalogStore.getState().setReady([{ id: 'a' }, { id: 'b' }], 1);
    useModelCatalogStore.getState().setStaleNotice('old-id');
    const { repo } = setup({});
    fireEvent.click(screen.getByRole('button', { name: 'a' }));
    await waitFor(() => {
      expect(useModelCatalogStore.getState().selectedId).toBe('a');
    });
    expect(useModelCatalogStore.getState().staleNotice).toBeNull();
    expect(repo.putSelectedModelId).toHaveBeenCalledWith('a');
  });

  it('refresh disables the button while loading', async () => {
    let resolveFetch!: (v: ModelsFetchResult) => void;
    const pending = new Promise<ModelsFetchResult>((r) => {
      resolveFetch = r;
    });
    const repo = fakeRepo();
    const fetchCatalog = vi.fn(() => pending);
    render(
      <ModelsSection
        settingsRepo={repo}
        fetchCatalog={fetchCatalog}
        getApiKey={() => 'sk-test'}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /refresh|loading/i })).toBeDisabled();
    });
    resolveFetch({ ok: true, models: [] });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /refresh/i })).toBeEnabled();
    });
  });

  it('stale notice can be dismissed', () => {
    useModelCatalogStore.getState().setReady([{ id: 'a' }], 1);
    useModelCatalogStore.getState().setStaleNotice('old');
    setup({});
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(useModelCatalogStore.getState().staleNotice).toBeNull();
  });
});
