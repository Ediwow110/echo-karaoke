import { RoomApiError, type EdgeApi } from '../../lib/edgeApi';
import { loadGuestToken, loadHostToken } from '../rooms/tokenStore';

export type QueueSong = {
  songId: string;
  videoId: string;
  title: string;
  channelTitle: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  status: string;
  position: number;
  memberId: string;
  addedBy: string;
  voteCount: number;
};

export type QueueAction =
  | { kind: 'add'; videoId: string }
  | { kind: 'remove'; songId: string }
  | { kind: 'reorder'; songId: string; direction: 'up' | 'down' };

function requireGuestPass(roomId: string): string {
  const token = loadGuestToken(roomId);
  if (token === null) {
    throw new Error('This browser has no guest pass for the room.');
  }
  return token;
}

export async function sendQueueCommand<T>(
  api: EdgeApi,
  roomId: string,
  action: QueueAction,
): Promise<T> {
  const hostToken = loadHostToken(roomId);

  if (hostToken !== null) {
    return api.invoke<T>(
      'queue-command',
      { roomId, action: action.kind, ...action },
      { hostToken },
    );
  }

  const guestToken = requireGuestPass(roomId);
  return api.invoke<T>(
    'queue-command',
    { roomId, action: action.kind, ...action },
    { guestToken },
  );
}

export async function addSong(
  api: EdgeApi,
  roomId: string,
  videoId: string,
): Promise<QueueSong> {
  return sendQueueCommand<QueueSong>(api, roomId, { kind: 'add', videoId });
}

/**
 * What a refused add says back to the room.
 *
 * The server answers a queue command with its own sentence -- "The host locked
 * guest controls" -- which is a log line, not a message for a guest holding a
 * phone. Every screen that adds a song has to say the same thing in the app's
 * voice, so the mapping lives beside the call rather than in one caller.
 */
export function describeAddError(error: unknown): string {
  if (error instanceof RoomApiError) {
    if (error.code === 'RATE_LIMITED') return 'That is five songs this minute. Give it a moment.';
    if (error.code === 'GUEST_CONTROLS_LOCKED') return 'The host turned off guest requests.';
    if (error.code === 'METADATA_UNAVAILABLE') return 'That video could not be read. Try another copy.';
    if (error.code === 'DUPLICATE_SONG') return 'That song is already in the queue.';
    if (error.code === 'ROOM_ENDED') return 'This room has ended.';
    if (error.code === 'NETWORK_ERROR') return 'The room service could not be reached. Try again.';
    return error.message;
  }
  return error instanceof Error ? error.message : 'That song could not be added.';
}

export async function removeSong(api: EdgeApi, roomId: string, songId: string): Promise<void> {
  await sendQueueCommand(api, roomId, { kind: 'remove', songId });
}

export async function reorderSong(
  api: EdgeApi,
  roomId: string,
  songId: string,
  direction: 'up' | 'down',
): Promise<void> {
  await sendQueueCommand(api, roomId, { kind: 'reorder', songId, direction });
}
