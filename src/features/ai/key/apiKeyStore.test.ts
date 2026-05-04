import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useApiKeyStore, useApiKeyState, getCurrentApiKey } from './apiKeyStore';

beforeEach(() => {
  useApiKeyStore.setState({ state: { kind: 'none' } });
});

describe('apiKeyStore', () => {
  it('initial state is none', () => {
    expect(useApiKeyStore.getState().state).toEqual({ kind: 'none' });
  });

  it('setSession transitions to session with key', () => {
    useApiKeyStore.getState().setSession('sk-1234');
    expect(useApiKeyStore.getState().state).toEqual({ kind: 'session', key: 'sk-1234' });
  });

  it('setUnlocked transitions to unlocked with key', () => {
    useApiKeyStore.getState().setUnlocked('sk-5678');
    expect(useApiKeyStore.getState().state).toEqual({ kind: 'unlocked', key: 'sk-5678' });
  });

  it('markLocked transitions to locked', () => {
    useApiKeyStore.getState().markLocked();
    expect(useApiKeyStore.getState().state).toEqual({ kind: 'locked' });
  });

  it('clear transitions to none from any state', () => {
    useApiKeyStore.getState().setSession('x');
    useApiKeyStore.getState().clear();
    expect(useApiKeyStore.getState().state).toEqual({ kind: 'none' });
    useApiKeyStore.getState().markLocked();
    useApiKeyStore.getState().clear();
    expect(useApiKeyStore.getState().state).toEqual({ kind: 'none' });
  });

  it('getCurrentApiKey returns the key in session and unlocked', () => {
    expect(getCurrentApiKey()).toBeNull();
    useApiKeyStore.getState().setSession('a');
    expect(getCurrentApiKey()).toBe('a');
    useApiKeyStore.getState().setUnlocked('b');
    expect(getCurrentApiKey()).toBe('b');
  });

  it('getCurrentApiKey returns null in locked and none', () => {
    useApiKeyStore.getState().markLocked();
    expect(getCurrentApiKey()).toBeNull();
    useApiKeyStore.getState().clear();
    expect(getCurrentApiKey()).toBeNull();
  });

  it('useApiKeyState selector subscribes correctly', () => {
    const { result } = renderHook(() => useApiKeyState());
    expect(result.current).toEqual({ kind: 'none' });
    act(() => {
      useApiKeyStore.getState().setSession('s1');
    });
    expect(result.current).toEqual({ kind: 'session', key: 's1' });
  });
});
