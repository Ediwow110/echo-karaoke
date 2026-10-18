import { useCallback, useEffect, useState } from 'react';
import { RoomApiError } from '../../lib/edgeApi';
import { readRoomAsGuest, readRoomAsHost } from './roomApi';
import { useRoomApi } from '../../app/RoomApiProvider';

export type RosterEntry = {
  memberId: string;
  displayName: string;
  role: string;
  online: boolean;
};

export type QueueEntry = {
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

export type RoomView = {
  roomId: string;
  status: string;
  room?: {
    id: string;
    code: string;
    status: string;
    guestControlLocked: boolean;
    createdAt: string;
    endedAt?: string | null;
  };
  viewer?: { memberId: string; displayName: string; role: string };
  roster?: RosterEntry[];
  queue?: QueueEntry[];
  playback?: {
    currentSongId: string | null;
    positionSeconds: number;
    isPlaying: boolean;
    updatedAt: string | null;
  };
  events?: { eventId: number; type: string; memberId: string | null; createdAt: string }[];
};

export type RoomState = {
  data: RoomView | null;
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
};

const POLL_INTERVAL_MS = 4000;

export function useRoomData(roomId: string, role: 'guest' | 'host'): RoomState {
  const api = useRoomApi();
  const [data, setData] = useState<RoomView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const view = role === 'host'
        ? await readRoomAsHost<RoomView>(api, roomId)
        : await readRoomAsGuest<RoomView>(api, roomId);
      setData(view);
      setError(null);
    } catch (caught) {
      if (caught instanceof RoomApiError && caught.code === 'ROOM_ENDED') {
        setData({ roomId, status: 'ended' });
        setError(null);
      } else {
        setError(caught instanceof Error ? caught.message : 'The room could not be loaded.');
      }
    } finally {
      setLoading(false);
    }
  }, [api, role, roomId]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return { data, error, loading, refresh };
}
