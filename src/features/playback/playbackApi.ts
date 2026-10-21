import type { EdgeApi } from '../../lib/edgeApi';
import { loadGuestToken, loadHostToken } from '../rooms/tokenStore';

export type PlaybackState = {
  currentSongId: string | null;
  currentVideoId: string | null;
  positionSeconds: number;
  isPlaying: boolean;
  updatedAt: string | null;
};

export type PlaybackAction = 'play' | 'pause' | 'next';

export type PlaybackResponse = {
  roomId: string;
  status: string;
  playback: PlaybackState;
};

export async function sendPlaybackCommand(
  api: EdgeApi,
  roomId: string,
  action: PlaybackAction,
): Promise<PlaybackResponse> {
  const hostToken = loadHostToken(roomId);
  if (hostToken !== null) {
    return api.invoke<PlaybackResponse>('playback-command', { roomId, action }, { hostToken });
  }

  const guestToken = loadGuestToken(roomId);
  if (guestToken === null) {
    throw new Error('This browser has no guest pass for the room.');
  }
  return api.invoke<PlaybackResponse>('playback-command', { roomId, action }, { guestToken });
}

export async function reportPlaybackPosition(
  api: EdgeApi,
  roomId: string,
  positionSeconds: number,
): Promise<PlaybackState> {
  const hostToken = loadHostToken(roomId);
  if (hostToken === null) {
    throw new Error('This browser has no host pass for the room.');
  }
  return api.invoke<PlaybackState>(
    'playback-report',
    { roomId, positionSeconds: Math.floor(positionSeconds) },
    { hostToken },
  );
}
