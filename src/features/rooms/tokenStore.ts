const GUEST_PREFIX = 'karaoke.guest.';
const HOST_PREFIX = 'karaoke.host.';

// Storage can be unavailable in private modes or after a quota error. Keep
// the pass in module memory so the current tab can still use the room.
const memory = new Map<string, { token: string; persisted: boolean }>();

function read(key: string): string | null {
  const cached = memory.get(key);
  // A failed replacement write must not restore the older persisted pass.
  if (cached?.persisted === false) {
    return cached.token;
  }
  try {
    // Storage is the cross-tab source of truth. The memory copy is only a
    // fallback for a browser that rejected the write; preferring it forever
    // strands this tab when another tab rotates the pass.
    const value = localStorage.getItem(key);
    if (value !== null && value.length > 0) {
      memory.set(key, { token: value, persisted: true });
      return value;
    }
    memory.delete(key);
    return null;
  } catch {
    // Fall through to the in-memory pass.
  }
  return cached?.token ?? null;
}

function syncFromStorage(event: StorageEvent): void {
  let storage: Storage;
  try {
    storage = localStorage;
  } catch {
    return;
  }
  if (event.storageArea !== storage) {
    return;
  }
  if (event.key === null) {
    memory.clear();
    return;
  }
  if (event.newValue === null || event.newValue.length === 0) {
    memory.delete(event.key);
    return;
  }
  memory.set(event.key, { token: event.newValue, persisted: true });
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', syncFromStorage);
}

function write(key: string, token: string): void {
  if (token.length === 0) {
    return;
  }
  memory.set(key, { token, persisted: false });
  try {
    localStorage.setItem(key, token);
    memory.set(key, { token, persisted: true });
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
