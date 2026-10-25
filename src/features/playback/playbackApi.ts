import type { EdgeApi, EdgeInvokeOptions } from '../../lib/edgeApi';
import { loadGuestToken, loadHostToken } from '../rooms/tokenStore';

export type PlaybackState = {
  currentSongId: string | null;
  currentVideoId: string | null;
  positionSeconds: number;
  durationSeconds?: number | null;
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
  options?: EdgeInvokeOptions,
  expectedSongId?: string,
): Promise<PlaybackResponse> {
  const body = { roomId, action, ...(expectedSongId === undefined ? {} : { expectedSongId }) };
  const hostToken = loadHostToken(roomId);
  if (hostToken !== null) {
    return api.invoke<PlaybackResponse>('playback-command', body, { hostToken }, options);
  }

  const guestToken = loadGuestToken(roomId);
  if (guestToken === null) {
    throw new Error('This browser has no guest pass for the room.');
  }
  return api.invoke<PlaybackResponse>('playback-command', body, { guestToken }, options);
}

export async function reportPlaybackPosition(
  api: EdgeApi,
  roomId: string,
  positionSeconds: number,
  durationSeconds?: number,
  songId?: string | null,
): Promise<PlaybackState> {
  const hostToken = loadHostToken(roomId);
  if (hostToken === null) {
    throw new Error('This browser has no host pass for the room.');
  }
  const position = Number.isFinite(positionSeconds) ? Math.max(0, Math.floor(positionSeconds)) : 0;
  const duration = durationSeconds !== undefined && Number.isFinite(durationSeconds)
    ? Math.max(0, Math.floor(durationSeconds))
    : null;
  return api.invoke<PlaybackState>(
    'playback-report',
    {
      roomId,
      positionSeconds: position,
      durationSeconds: duration,
      songId: songId ?? null,
    },
    { hostToken },
  );
}
