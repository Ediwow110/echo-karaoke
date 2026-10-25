import { isValidRoomCode, normalizeRoomCode } from './roomCode';

const ROOM_ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function buildJoinUrl(origin: string, code: string): string {
  const base = origin.endsWith('/') ? origin.slice(0, -1) : origin;
  return base + '/join/' + code;
}

export function readJoinCodeFromPath(pathname: string): string | null {
  const segments = pathname.split('/').filter((segment) => segment.length > 0);
  if (segments.length !== 2 || segments[0] !== 'join') {
    return null;
  }

  try {
    const decoded = decodeURIComponent(segments[1]);
    if (!/^[A-Za-z0-9\s-]+$/.test(decoded)) return null;
    const code = normalizeRoomCode(decoded);
    return isValidRoomCode(code) ? code : null;
  } catch {
    return null;
  }
}

export function readRoomIdFromPath(pathname: string): string | null {
  const segments = pathname.split('/').filter((segment) => segment.length > 0);
  if (segments.length < 2 || segments[0] !== 'room') {
    return null;
  }

  let roomId: string;
  try {
    roomId = decodeURIComponent(segments[1]);
  } catch {
    return null;
  }
  if (!ROOM_ID.test(roomId)) {
    return null;
  }
  if (segments.length === 3 && segments[2] !== 'host') {
    return null;
  }
  if (segments.length > 3) {
    return null;
  }

  return roomId;
}
