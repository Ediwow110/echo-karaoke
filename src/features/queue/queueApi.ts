import type { EdgeApi } from '../../lib/edgeApi';
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
