/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { SettingsView } from './SettingsView';
import { useApiKeyStore } from '../key/apiKeyStore';
import type { SettingsRepository, ApiKeyBlob } from '@/storage';

afterEach(cleanup);

const originalFetch = global.fetch;

beforeEach(() => {
  useApiKeyStore.setState({ state: { kind: 'none' } });
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
});

function fakeRepo(overrides: Partial<SettingsRepository> = {}): SettingsRepository {
  let blob: ApiKeyBlob | undefined;
  return {
    getLibrarySort: vi.fn(() => Promise.resolve(undefined)),
    setLibrarySort: vi.fn(() => Promise.resolve()),
    getStoragePersistResult: vi.fn(() => Promise.resolve(undefined)),
    setStoragePersistResult: vi.fn(() => Promise.resolve()),
    getView: vi.fn(() => Promise.resolve(undefined)),
    setView: vi.fn(() => Promise.resolve()),
    getFocusModeHintShown: vi.fn(() => Promise.resolve(false)),
    setFocusModeHintShown: vi.fn(() => Promise.resolve()),
    getApiKeyBlob: vi.fn(() => Promise.resolve(blob)),
    putApiKeyBlob: vi.fn((b: ApiKeyBlob) => {
      blob = b;
      return Promise.resolve();
    }),
    deleteApiKeyBlob: vi.fn(() => {
      blob = undefined;
      return Promise.resolve();
    }),
    ...overrides,
  };
}

function mockFetch200WithModels(): void {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ data: [{ id: 'm-1' }] }),
  });
}

function mockFetch401(): void {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: false,
    status: 401,
    json: () => Promise.resolve({}),
  });
}

function submitButton(): HTMLButtonElement {
  const btn = screen
    .getAllByRole('button')
    .find((b) => b.getAttribute('type') === 'submit') as HTMLButtonElement | undefined;
  if (!btn) throw new Error('submit button not found');
  return btn;
}

describe('SettingsView', () => {
  it('renders ApiKeyForm when state is none', () => {
    render(<SettingsView settingsRepo={fakeRepo()} onClose={() => undefined} />);
    expect(screen.getByLabelText(/NanoGPT API key/i)).toBeInTheDocument();
  });

  it('session submit → calls validateKey → store transitions to session', async () => {
    mockFetch200WithModels();
    const repo = fakeRepo();
    render(<SettingsView settingsRepo={repo} onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText(/NanoGPT API key/i), {
      target: { value: 'sk-test' },
    });
    fireEvent.click(submitButton());
    await waitFor(() => {
      expect(useApiKeyStore.getState().state).toEqual({ kind: 'session', key: 'sk-test' });
    });
    expect(global.fetch).toHaveBeenCalledOnce();
  });

  it('save submit → encrypts + persists + store transitions to unlocked', async () => {
    mockFetch200WithModels();
    const repo = fakeRepo();
    render(<SettingsView settingsRepo={repo} onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText(/NanoGPT API key/i), {
      target: { value: 'sk-test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save on this device/i }));
    fireEvent.change(screen.getByLabelText(/Passphrase/i), {
      target: { value: 'pp' },
    });
    fireEvent.click(submitButton());
    await waitFor(
      () => {
        expect(useApiKeyStore.getState().state).toEqual({ kind: 'unlocked', key: 'sk-test' });
      },
      { timeout: 8_000 },
    );
    expect(repo.putApiKeyBlob).toHaveBeenCalled();
  }, 10_000);

  it('session state shows status card with Save + Remove buttons', () => {
    useApiKeyStore.setState({ state: { kind: 'session', key: 'sk-x' } });
    render(<SettingsView settingsRepo={fakeRepo()} onClose={() => undefined} />);
    expect(screen.getByText(/using API key for this session/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save on this device/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Remove/i })).toBeInTheDocument();
  });

  it('unlocked state shows status card with Remove only', () => {
    useApiKeyStore.setState({ state: { kind: 'unlocked', key: 'sk-x' } });
    render(<SettingsView settingsRepo={fakeRepo()} onClose={() => undefined} />);
    expect(screen.getByText(/API key unlocked/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Remove/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save on this device/i })).toBeNull();
  });

  it('locked state shows UnlockForm + Remove escape', () => {
    useApiKeyStore.setState({ state: { kind: 'locked' } });
    render(<SettingsView settingsRepo={fakeRepo()} onClose={() => undefined} />);
    expect(screen.getByLabelText(/passphrase/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Unlock$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Remove saved key/i })).toBeInTheDocument();
  });

  it('Remove with confirm wipes blob + transitions to none', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    useApiKeyStore.setState({ state: { kind: 'unlocked', key: 'sk-x' } });
    const repo = fakeRepo();
    await repo.putApiKeyBlob({
      salt: new ArrayBuffer(16),
      iv: new ArrayBuffer(12),
      ciphertext: new ArrayBuffer(8),
      iterations: 600_000,
    });
    render(<SettingsView settingsRepo={repo} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /Remove/i }));
    await waitFor(() => {
      expect(useApiKeyStore.getState().state).toEqual({ kind: 'none' });
    });
    expect(repo.deleteApiKeyBlob).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('Remove without confirm does nothing', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    useApiKeyStore.setState({ state: { kind: 'unlocked', key: 'sk-x' } });
    const repo = fakeRepo();
    render(<SettingsView settingsRepo={repo} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /Remove/i }));
    expect(useApiKeyStore.getState().state).toEqual({ kind: 'unlocked', key: 'sk-x' });
    expect(repo.deleteApiKeyBlob).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('validation 401 → form shows invalid-key message; store stays none', async () => {
    mockFetch401();
    render(<SettingsView settingsRepo={fakeRepo()} onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText(/NanoGPT API key/i), {
      target: { value: 'sk-bad' },
    });
    fireEvent.click(submitButton());
    await waitFor(() => {
      expect(screen.getByText(/rejected by NanoGPT/i)).toBeInTheDocument();
    });
    expect(useApiKeyStore.getState().state).toEqual({ kind: 'none' });
  });

  it('session→save upgrade: shows passphrase form, encrypts, transitions to unlocked', async () => {
    useApiKeyStore.setState({ state: { kind: 'session', key: 'sk-already-validated' } });
    const repo = fakeRepo();
    render(<SettingsView settingsRepo={repo} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /Save on this device/i }));
    expect(screen.getByLabelText(/Passphrase/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/NanoGPT API key/i)).toBeNull();
    fireEvent.change(screen.getByLabelText(/Passphrase/i), { target: { value: 'pp' } });
    fireEvent.click(submitButton());
    await waitFor(
      () => {
        expect(useApiKeyStore.getState().state).toEqual({
          kind: 'unlocked',
          key: 'sk-already-validated',
        });
      },
      { timeout: 8_000 },
    );
    expect(global.fetch).not.toHaveBeenCalled();
    expect(repo.putApiKeyBlob).toHaveBeenCalled();
  }, 10_000);
});
