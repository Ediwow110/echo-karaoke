const GUEST_PREFIX = 'karaoke.guest.';
const HOST_PREFIX = 'karaoke.host.';

// Storage can be unavailable in private modes or after a quota error. Keep
// the pass in module memory so the current tab can still use the room.
const memory = new Map<string, string>();

function read(key: string): string | null {
  const cached = memory.get(key);
  if (cached !== undefined) {
    return cached;
  }
  try {
    const value = localStorage.getItem(key);
    if (value === null || value.length === 0) {
      return null;
    }
    memory.set(key, value);
    return value;
  } catch {
    return null;
  }
}

function write(key: string, token: string): void {
  if (token.length === 0) {
    return;
  }
  memory.set(key, token);
  try {
    localStorage.setItem(key, token);
  } catch {
    // The in-memory pass keeps this tab usable; a reload cannot recover it.
  }
}

function remove(key: string): void {
  memory.delete(key);
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
