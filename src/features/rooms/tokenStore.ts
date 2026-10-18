const GUEST_PREFIX = 'karaoke.guest.';
const HOST_PREFIX = 'karaoke.host.';

function read(key: string): string | null {
  try {
    const value = localStorage.getItem(key);
    return value === null || value.length === 0 ? null : value;
  } catch {
    return null;
  }
}

function write(key: string, token: string): void {
  if (token.length === 0) {
    return;
  }
  try {
    localStorage.setItem(key, token);
  } catch {
    // Storage can be unavailable in private modes; the session then stays in memory.
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore removal failures for unavailable storage.
  }
}

export function saveGuestToken(roomId: string, token: string): void {
  write(GUEST_PREFIX + roomId, token);
}

export function loadGuestToken(roomId: string): string | null {
  return read(GUEST_PREFIX + roomId);
}

export function clearGuestToken(roomId: string): void {
  remove(GUEST_PREFIX + roomId);
}

export function saveHostToken(roomId: string, token: string): void {
  write(HOST_PREFIX + roomId, token);
}

export function loadHostToken(roomId: string): string | null {
  return read(HOST_PREFIX + roomId);
}

export function clearRoomTokens(roomId: string): void {
  remove(GUEST_PREFIX + roomId);
  remove(HOST_PREFIX + roomId);
}
