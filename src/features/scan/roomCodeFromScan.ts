import { isValidRoomCode, normalizeRoomCode } from '../rooms/roomCode';

/**
 * Reads a room code out of the text a camera just decoded.
 * The host screen encodes a /join/<code> link. Reject other URL paths
 * rather than treating any unrelated URL's last segment as a room.
 * A standalone, optionally grouped room code is also supported.
 */
export function roomCodeFromScan(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (/^[0-9a-z -]+$/i.test(trimmed)) {
    const code = normalizeRoomCode(trimmed);
    return isValidRoomCode(code) ? code : null;
  }
  try {
    const url = new URL(trimmed, 'https://kara-echo.invalid');
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length !== 2 || segments[0] !== 'join') return null;
    const segment = decodeURIComponent(segments[1]);
    if (!/^[0-9a-z-]+$/i.test(segment)) return null;
    const code = normalizeRoomCode(segment);
    return isValidRoomCode(code) ? code : null;
  } catch {
    return null;
  }
}
