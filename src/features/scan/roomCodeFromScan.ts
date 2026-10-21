import { isValidRoomCode, normalizeRoomCode } from '../rooms/roomCode';

/**
 * Reads a room code out of the text a camera just decoded.
 * The host screen encodes a join link, so the code sits in the last path
 * segment. A code that was scanned on its own is read as it is.
 */
export function roomCodeFromScan(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const withoutQuery = trimmed.split('?')[0] ?? trimmed;
  const segments = withoutQuery.split('/').filter((segment) => segment.length > 0);
  const lastSegment = segments.length > 0 ? segments[segments.length - 1] : trimmed;

  for (const candidate of [lastSegment, trimmed]) {
    const normalized = normalizeRoomCode(candidate);
    if (isValidRoomCode(normalized)) {
      return normalized;
    }
  }

  return null;
}
