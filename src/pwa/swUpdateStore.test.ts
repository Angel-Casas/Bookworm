import { describe, it, expect, beforeEach } from 'vitest';
import { swUpdateStore } from './swUpdateStore';

const STORAGE_KEY = 'bookworm.offlineReadySeen';

beforeEach(() => {
  localStorage.clear();
  swUpdateStore.setState({
    needsRefresh: false,
    offlineReady: false,
    applyUpdate: () => Promise.resolve(),
  });
});

describe('swUpdateStore', () => {
  it('initial state has both flags false and a noop applyUpdate', () => {
    const s = swUpdateStore.getState();
    expect(s.needsRefresh).toBe(false);
    expect(s.offlineReady).toBe(false);
    return s.applyUpdate();
  });

  it('setApplyUpdate replaces the function', async () => {
    let called = false;
    swUpdateStore.getState().setApplyUpdate(() => {
      called = true;
      return Promise.resolve();
    });
    await swUpdateStore.getState().applyUpdate();
    expect(called).toBe(true);
  });

  it('markNeedsRefresh sets needsRefresh = true', () => {
    swUpdateStore.getState().markNeedsRefresh();
    expect(swUpdateStore.getState().needsRefresh).toBe(true);
  });

  it('markOfflineReady sets offlineReady = true when localStorage flag is absent', () => {
    swUpdateStore.getState().markOfflineReady();
    expect(swUpdateStore.getState().offlineReady).toBe(true);
  });

  it('markOfflineReady is a no-op when localStorage flag is present', () => {
    localStorage.setItem(STORAGE_KEY, '1');
    swUpdateStore.getState().markOfflineReady();
    expect(swUpdateStore.getState().offlineReady).toBe(false);
  });

  it('dismissNeedsRefresh sets needsRefresh = false', () => {
    swUpdateStore.setState({ needsRefresh: true });
    swUpdateStore.getState().dismissNeedsRefresh();
    expect(swUpdateStore.getState().needsRefresh).toBe(false);
  });

  it('dismissOfflineReady writes the localStorage flag and sets offlineReady = false', () => {
    swUpdateStore.setState({ offlineReady: true });
    swUpdateStore.getState().dismissOfflineReady();
    expect(swUpdateStore.getState().offlineReady).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1');
  });

  it('survives localStorage failures gracefully (markOfflineReady)', () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- captured to restore after the test
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('blocked');
    };
    try {
      swUpdateStore.getState().markOfflineReady();
      expect(swUpdateStore.getState().offlineReady).toBe(true);
    } finally {
      Storage.prototype.getItem = original;
    }
  });

  it('survives localStorage failures gracefully (dismissOfflineReady)', () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- captured to restore after the test
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('blocked');
    };
    try {
      swUpdateStore.setState({ offlineReady: true });
      swUpdateStore.getState().dismissOfflineReady();
      expect(swUpdateStore.getState().offlineReady).toBe(false);
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});
