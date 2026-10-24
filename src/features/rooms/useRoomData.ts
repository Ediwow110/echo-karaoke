import { useCallback, useEffect, useRef, useState } from 'react';
import { RoomApiError } from '../../lib/edgeApi';
import { readRoomAsGuest, readRoomAsHost, touchRoomMember } from './roomApi';
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
    name: string;
    status: string;
    guestControlLocked: boolean;
    guestPlaybackLocked: boolean;
    createdAt: string;
    endedAt?: string | null;
  };
  viewer?: { memberId: string; displayName: string; role: string };
  roster?: RosterEntry[];
  queue?: QueueEntry[];
  playback?: {
    currentSongId: string | null;
    currentVideoId: string | null;
    positionSeconds: number;
    durationSeconds?: number | null;
    isPlaying: boolean;
    updatedAt: string | null;
  };
  events?: { eventId: number; type: string; memberId: string | null; createdAt: string }[];
};

export type ConnectionState = 'connecting' | 'live' | 'offline';

export type RoomState = {
  data: RoomView | null;
  error: string | null;
  loading: boolean;
  connection: ConnectionState;
  restoredAt: number | null;
  lastLiveAt: number | null;
  refresh: () => Promise<void>;
};

const POLL_INTERVAL_MS = 4000;
const HIDDEN_HEARTBEAT_MS = 15_000;
const VISIBLE_HEARTBEAT_MS = 10_000;

export function useRoomData(roomId: string, role: 'guest' | 'host'): RoomState {
  const api = useRoomApi();
  const [data, setData] = useState<RoomView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const [lastLiveAt, setLastLiveAt] = useState<number | null>(null);
  const active = useRef(true);
  const requestId = useRef(0);
  const wasOffline = useRef(false);
  const consecutiveFailures = useRef(0);
  const dataRef = useRef<RoomView | null>(null);
  const lastHeartbeatAt = useRef(0);
  const lastVisibleTouchAt = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);
  const queued = useRef(false);
  const operationSeq = useRef(0);
  const initializedFor = useRef<string | null>(null);

  const runRefresh = useCallback(async () => {
    if (dataRef.current?.status === 'ended') {
      return;
    }
    if (typeof document !== 'undefined' && document.hidden && dataRef.current !== null) {
      if (Date.now() - lastHeartbeatAt.current >= HIDDEN_HEARTBEAT_MS) {
        lastHeartbeatAt.current = Date.now();
        await touchRoomMember(api, roomId, role);
      }
      return;
    }
    const now = Date.now();
    lastHeartbeatAt.current = now;
    const current = requestId.current + 1;
    requestId.current = current;
    try {
      // The SQL touch is throttled to ten seconds. Do not spend a function
      // invocation on every four-second read for a write that would be skipped.
      if (now - lastVisibleTouchAt.current >= VISIBLE_HEARTBEAT_MS) {
        lastVisibleTouchAt.current = now;
        void touchRoomMember(api, roomId, role).catch(() => undefined);
      }
      const view = role === 'host'
        ? await readRoomAsHost<RoomView>(api, roomId)
        : await readRoomAsGuest<RoomView>(api, roomId);
      if (!active.current || requestId.current !== current) {
        return;
      }
      dataRef.current = view;
      consecutiveFailures.current = 0;
      setData(view);
      setError(null);
      setConnection('live');
      setLastLiveAt(Date.now());
      if (wasOffline.current) {
        wasOffline.current = false;
        setRestoredAt(Date.now());
      }
    } catch (caught) {
      if (!active.current || requestId.current !== current) {
        return;
      }
      if (caught instanceof RoomApiError
        && (caught.code === 'ROOM_ENDED' || caught.code === 'ROOM_NOT_FOUND')) {
        // A missing room may have been reclaimed after everyone left.
        const ended = { roomId, status: 'ended' };
        dataRef.current = ended;
        setData(ended);
        setError(null);
        setConnection('live');
        return;
      }
      const message = caught instanceof Error ? caught.message : 'The room could not be loaded.';
      const authFailure = (caught instanceof RoomApiError
        && (caught.code === 'UNAUTHORIZED' || caught.code === 'FORBIDDEN' || caught.code === 'NO_SESSION'))
        || (caught instanceof Error && /no (guest|host) pass/i.test(caught.message));

      if (authFailure) {
        // A revoked or missing pass must not leave stale room data and live
        // controls on screen. Send the user back through the error screen.
        dataRef.current = null;
        setData(null);
        setError(message);
        setConnection('connecting');
        return;
      }

      if (dataRef.current === null) {
        setError(message);
        setConnection('connecting');
      } else {
        consecutiveFailures.current += 1;
        if (consecutiveFailures.current >= 2) {
          wasOffline.current = true;
          setConnection('offline');
        }
      }
    } finally {
      if (active.current && requestId.current === current) {
        setLoading(false);
      }
    }
  }, [api, role, roomId]);

  // Only one read may be in flight. Without this guard a slow response is
  // replaced by the next four-second tick before it can clear `loading`, so a
  // room can sit on its skeleton forever and every tick adds another request.
  const startRefresh = useCallback((): Promise<void> => {
    if (inFlight.current !== null) {
      queued.current = true;
      return inFlight.current;
    }
    const seq = operationSeq.current + 1;
    operationSeq.current = seq;
    const operation = (async () => {
      try {
        do {
          queued.current = false;
          await runRefresh();
        } while (queued.current && active.current && operationSeq.current === seq);
      } finally {
        // A room switch replaces the guard with a new operation. Only the
        // operation that owns the current sequence may clear it.
        if (operationSeq.current === seq) {
          inFlight.current = null;
        }
      }
    })();
    inFlight.current = operation;
    return operation;
  }, [runRefresh]);

  const poll = useCallback((): void => {
    if (inFlight.current !== null) {
      return;
    }
    void startRefresh();
  }, [startRefresh]);

  const refresh = useCallback((): Promise<void> => startRefresh(), [startRefresh]);

  useEffect(() => {
    // Route parameters can change without remounting a page. Clear every
    // room-scoped value before the first read for the new room. StrictMode
    // replays effects on mount, so ignore that second setup: resetting the
    // in-flight guard here would let two initial reads run at once.
    const key = `${role}:${roomId}`;
    if (initializedFor.current === key) {
      return;
    }
    initializedFor.current = key;
    requestId.current += 1;
    operationSeq.current += 1;
    inFlight.current = null;
    queued.current = false;
    dataRef.current = null;
    consecutiveFailures.current = 0;
    wasOffline.current = false;
    setData(null);
    setError(null);
    setLoading(true);
    setConnection('connecting');
    setRestoredAt(null);
    setLastLiveAt(null);
  }, [role, roomId]);

  useEffect(() => {
    active.current = true;
    poll();
    const timer = window.setInterval(poll, POLL_INTERVAL_MS);

    const onVisibility = (): void => {
      if (document.hidden) {
        return;
      }
      void startRefresh();
    };
    const onOnline = (): void => {
      void startRefresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);

    return () => {
      active.current = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
    };
  }, [poll, startRefresh]);

  return { data, error, loading, connection, restoredAt, lastLiveAt, refresh };
}
