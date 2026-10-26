import { normalizeRoomCode } from './roomCode';
import { loadHostToken } from './tokenStore';

export type RoomRole = 'host' | 'guest';
export type RoomSession = {
  roomId: string;
  code: string;
  roomName: string;
  hostName: string;
  role: RoomRole;
  lastSeenAt: string;
};

export type LastRoom = {
  roomId: string;
  role: RoomRole;
};

const SESSIONS_KEY = 'karaoke.sessions';
const LAST_ROOM_KEY = 'karaoke.last-room';
const SESSION_LIMIT = 8;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null || raw.length === 0) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable in private modes.
  }
}

function isSession(value: unknown): value is RoomSession {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const session = value as Partial<RoomSession>;
  return typeof session.roomId === 'string'
    && typeof session.code === 'string'
    && typeof session.roomName === 'string'
    && typeof session.hostName === 'string'
    && (session.role === 'host' || session.role === 'guest')
    && typeof session.lastSeenAt === 'string';
}

function getSessions(): RoomSession[] {
  const stored = readJson<unknown>(SESSIONS_KEY, []);
  if (!Array.isArray(stored)) {
    return [];
  }
  return stored
    .filter(isSession)
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

export function rememberSession(session: Omit<RoomSession, 'lastSeenAt'>): void {
  const now = new Date().toISOString();
  const existing = getSessions().filter((entry) => entry.roomId !== session.roomId);
  writeJson(SESSIONS_KEY, [{ ...session, lastSeenAt: now }, ...existing].slice(0, SESSION_LIMIT));
  writeJson(LAST_ROOM_KEY, { roomId: session.roomId, role: session.role } satisfies LastRoom);
}

export function touchSession(roomId: string, patch?: Partial<Pick<RoomSession, 'roomName' | 'hostName'>>): void {
  const sessions = getSessions();
  const current = sessions.find((entry) => entry.roomId === roomId);
  if (current === undefined) {
    return;
  }
  const next = sessions
    .map((entry) => entry.roomId === roomId
      ? { ...entry, ...patch, lastSeenAt: new Date().toISOString() }
      : entry)
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  writeJson(SESSIONS_KEY, next);
  writeJson(LAST_ROOM_KEY, { roomId, role: current.role } satisfies LastRoom);
}

export function getLastRoom(): LastRoom | null {
  const stored = readJson<Partial<LastRoom> | null>(LAST_ROOM_KEY, null);
  if (stored === null || typeof stored.roomId !== 'string') {
    return null;
  }
  if (stored.role !== 'host' && stored.role !== 'guest') {
    return null;
  }
  return { roomId: stored.roomId, role: stored.role };
}

export function getLastRoomSession(): RoomSession | null {
  const last = getLastRoom();
  if (last === null) {
    return null;
  }
  return getSessions().find((session) => session.roomId === last.roomId) ?? null;
}

export function getHostSessionByCode(code: string): RoomSession | null {
  const normalized = normalizeRoomCode(code);
  if (normalized.length === 0) {
    return null;
  }
  return getSessions().find((session) => session.role === 'host' && session.code === normalized) ?? null;
}

export function clearLastRoom(): void {
  try {
    localStorage.removeItem(LAST_ROOM_KEY);
  } catch {
    // Ignore unavailable storage.
  }
}

/**
 * The room this browser hosted and can still command.
 *
 * The host screen owns the only player, so a host who leaves it for another
 * room would otherwise lose the room their guests are still standing in. The
 * session is only a candidate: whether the room is still alive is the
 * server's answer, not a local timestamp.
 */
export function getHostedRoom(): RoomSession | null {
  return getSessions().find(
    (entry) => entry.role === 'host' && loadHostToken(entry.roomId) !== null,
  ) ?? null;
}

/**
 * Drop a room this browser no longer hosts. An ended room must not come back
 * as an offer, and the last-room pointer must not lead into it either.
 */
export function forgetSession(roomId: string): void {
  const remaining = getSessions().filter((entry) => entry.roomId !== roomId);
  writeJson(SESSIONS_KEY, remaining);
  const last = getLastRoom();
  if (last !== null && last.roomId === roomId) {
    clearLastRoom();
  }
}

