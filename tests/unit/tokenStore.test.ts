import { beforeEach, describe, expect, it } from 'vitest';
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
});
