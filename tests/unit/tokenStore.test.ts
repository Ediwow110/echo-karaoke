import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearGuestToken,
  clearRoomTokens,
  loadGuestToken,
  loadHostToken,
  saveGuestToken,
  saveHostToken,
} from '../../src/features/rooms/tokenStore';

describe('room token storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps tokens scoped to their room', () => {
    saveGuestToken('room-a', 'guest-a');
    saveGuestToken('room-b', 'guest-b');
    saveHostToken('room-a', 'host-a');

    expect(loadGuestToken('room-a')).toBe('guest-a');
    expect(loadGuestToken('room-b')).toBe('guest-b');
    expect(loadHostToken('room-a')).toBe('host-a');
    expect(loadHostToken('room-b')).toBeNull();
  });

  it('returns null for unknown rooms', () => {
    expect(loadGuestToken('missing')).toBeNull();
    expect(loadHostToken('missing')).toBeNull();
  });

  it('clears a guest token without touching the host token', () => {
    saveGuestToken('room-a', 'guest-a');
    saveHostToken('room-a', 'host-a');

    clearGuestToken('room-a');

    expect(loadGuestToken('room-a')).toBeNull();
    expect(loadHostToken('room-a')).toBe('host-a');
  });

  it('clears every token for a room', () => {
    saveGuestToken('room-a', 'guest-a');
    saveHostToken('room-a', 'host-a');

    clearRoomTokens('room-a');

    expect(loadGuestToken('room-a')).toBeNull();
    expect(loadHostToken('room-a')).toBeNull();
  });

  it('does not store empty tokens', () => {
    saveGuestToken('room-a', '');
    expect(loadGuestToken('room-a')).toBeNull();
  });

  it('keeps a pass in memory when local storage rejects the write', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    saveHostToken('room-a', 'host-a');
    expect(loadHostToken('room-a')).toBe('host-a');

    setItem.mockRestore();
  });

  it('re-reads a pass another tab rotated in storage', () => {
    saveGuestToken('room-cross', 'first');
    expect(loadGuestToken('room-cross')).toBe('first');

    localStorage.setItem('karaoke.guest.room-cross', 'second');

    expect(loadGuestToken('room-cross')).toBe('second');
  });

  it('drops an in-memory copy when another tab removes the pass', () => {
    saveHostToken('room-cross', 'host');
    expect(loadHostToken('room-cross')).toBe('host');

    localStorage.removeItem('karaoke.host.room-cross');
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'karaoke.host.room-cross',
      newValue: null,
      storageArea: localStorage,
    }));

    expect(loadHostToken('room-cross')).toBeNull();
  });

  it('drops all cached passes when another tab clears local storage', () => {
    saveGuestToken('room-cleared-a', 'guest');
    saveHostToken('room-cleared-b', 'host');
    localStorage.clear();
    window.dispatchEvent(new StorageEvent('storage', {
      key: null,
      newValue: null,
      storageArea: localStorage,
    }));

    expect(loadGuestToken('room-cleared-a')).toBeNull();
    expect(loadHostToken('room-cleared-b')).toBeNull();
  });

  it('does not resurrect a removed persisted pass before its storage event', () => {
    saveHostToken('room-removed', 'host');
    localStorage.removeItem('karaoke.host.room-removed');

    expect(loadHostToken('room-removed')).toBeNull();
  });

  it('keeps a failed replacement write ahead of an older stored pass', () => {
    saveHostToken('room-replacement', 'old');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    saveHostToken('room-replacement', 'replacement');

    expect(loadHostToken('room-replacement')).toBe('replacement');
  });

  it('accepts cross-tab rotation after a failed replacement write', () => {
    saveHostToken('room-replacement-event', 'old');
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    saveHostToken('room-replacement-event', 'replacement');
    setItem.mockRestore();
    localStorage.setItem('karaoke.host.room-replacement-event', 'other-tab');
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'karaoke.host.room-replacement-event',
      newValue: 'other-tab',
      storageArea: localStorage,
    }));

    expect(loadHostToken('room-replacement-event')).toBe('other-tab');
  });

  it('does not clear a memory fallback on another storage area event', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    saveHostToken('room-session-storage', 'memory-only');
    window.dispatchEvent(new StorageEvent('storage', {
      key: null,
      newValue: null,
      storageArea: sessionStorage,
    }));

    expect(loadHostToken('room-session-storage')).toBe('memory-only');
  });

  it('keeps a cached pass usable when reading storage becomes unavailable', () => {
    saveHostToken('room-read-error', 'host');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    expect(loadHostToken('room-read-error')).toBe('host');
  });
});
