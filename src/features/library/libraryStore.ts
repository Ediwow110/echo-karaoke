export type LibrarySong = {
  videoId: string;
  title: string;
  channelTitle: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  savedAt: string;
  lastSeenAt: string;
};

export type RecentSong = LibrarySong & {
  playedAt: string;
};

type SongInput = {
  videoId: string;
  title: string;
  channelTitle?: string | null;
  thumbnailUrl?: string | null;
  durationSeconds?: number | null;
};

const LIBRARY_KEY = 'karaoke.library';
const FAVORITES_KEY = 'karaoke.favorites';
const RECENT_KEY = 'karaoke.recent';
const LIBRARY_LIMIT = 200;
const RECENT_LIMIT = 40;
const CHANGE_EVENT = 'karaoke:library-change';

const memory = new Map<string, unknown>();
const failedWrites = new Set<string>();

function readJson<T>(key: string, fallback: T): T {
  // Only prefer memory when the last write for this key could not persist.
  // Otherwise an external localStorage.clear must remain authoritative.
  if (failedWrites.has(key)) {
    return (memory.get(key) as T | undefined) ?? fallback;
  }
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return (memory.get(key) as T | undefined) ?? fallback;
  }
  if (raw === null || raw.length === 0) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  memory.set(key, value);
  try {
    localStorage.setItem(key, JSON.stringify(value));
    failedWrites.delete(key);
  } catch {
    // Keep this tab truthful; a reload cannot recover the in-memory copy.
    failedWrites.add(key);
  }
}

function notify(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function isLibrarySong(value: unknown): value is LibrarySong {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const song = value as Partial<LibrarySong>;
  return typeof song.videoId === 'string'
    && typeof song.title === 'string'
    && (song.channelTitle === null || typeof song.channelTitle === 'string')
    && (song.thumbnailUrl === null || typeof song.thumbnailUrl === 'string')
    && (song.durationSeconds === null || typeof song.durationSeconds === 'number')
    && typeof song.savedAt === 'string'
    && typeof song.lastSeenAt === 'string';
}

function toLibrarySong(input: SongInput, now: string, existing?: LibrarySong): LibrarySong {
  return {
    videoId: input.videoId,
    title: input.title,
    channelTitle: input.channelTitle ?? existing?.channelTitle ?? null,
    thumbnailUrl: input.thumbnailUrl ?? existing?.thumbnailUrl ?? null,
    durationSeconds: input.durationSeconds ?? existing?.durationSeconds ?? null,
    savedAt: existing?.savedAt ?? now,
    lastSeenAt: now,
  };
}

export function getLibrary(): LibrarySong[] {
  const stored = readJson<unknown>(LIBRARY_KEY, []);
  if (!Array.isArray(stored)) {
    return [];
  }
  return stored
    .filter(isLibrarySong)
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

function writeLibrary(songs: LibrarySong[]): void {
  writeJson(LIBRARY_KEY, songs.slice(0, LIBRARY_LIMIT));
}

export function rememberSongs(inputs: SongInput[]): void {
  if (inputs.length === 0) {
    return;
  }
  const now = new Date().toISOString();
  const map = new Map(getLibrary().map((song) => [song.videoId, song]));
  let changed = false;
  for (const input of inputs) {
    if (input.videoId.length === 0 || input.title.length === 0) {
      continue;
    }
    const existing = map.get(input.videoId);
    map.set(input.videoId, toLibrarySong(input, now, existing));
    changed = true;
  }
  if (!changed) {
    return;
  }
  writeLibrary([...map.values()].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)));
  notify();
}

export function rememberPlayed(inputs: SongInput[]): void {
  if (inputs.length === 0) {
    return;
  }
  rememberSongs(inputs);
  const now = new Date().toISOString();
  const stored = readJson<unknown>(RECENT_KEY, []);
  const existing = (Array.isArray(stored) ? stored : [])
    .filter(isLibrarySong)
    .filter((song) => !inputs.some((input) => input.videoId === song.videoId));
  const next: RecentSong[] = inputs.map((input) => ({
    ...toLibrarySong(input, now),
    playedAt: now,
  }));
  writeJson(RECENT_KEY, [...next, ...existing].slice(0, RECENT_LIMIT));
  notify();
}

export function getRecent(): RecentSong[] {
  const stored = readJson<unknown>(RECENT_KEY, []);
  if (!Array.isArray(stored)) {
    return [];
  }
  return (stored as RecentSong[])
    .filter((song) => isLibrarySong(song) && typeof song.playedAt === 'string')
    .sort((a, b) => b.playedAt.localeCompare(a.playedAt));
}

export function getFavoriteIds(): string[] {
  const stored = readJson<unknown>(FAVORITES_KEY, []);
  if (!Array.isArray(stored)) {
    return [];
  }
  return stored.filter((value): value is string => typeof value === 'string');
}

export function isFavorite(videoId: string): boolean {
  return getFavoriteIds().includes(videoId);
}

export function toggleFavorite(input: SongInput): boolean {
  rememberSongs([input]);
  const favorites = getFavoriteIds();
  const exists = favorites.includes(input.videoId);
  const next = exists ? favorites.filter((videoId) => videoId !== input.videoId) : [...favorites, input.videoId];
  writeJson(FAVORITES_KEY, next);
  notify();
  return !exists;
}

export function getFavoriteSongs(): LibrarySong[] {
  const ids = new Set(getFavoriteIds());
  return getLibrary().filter((song) => ids.has(song.videoId));
}

export function subscribeLibrary(listener: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', listener);
  };
}
