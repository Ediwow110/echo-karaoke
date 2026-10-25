import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, StrictMode, type ReactNode } from 'react';
import { RoomApiProvider } from '../../src/app/RoomApiProvider';
import { useRoomData } from '../../src/features/rooms/useRoomData';
import { saveGuestToken } from '../../src/features/rooms/tokenStore';
import { RoomApiError, type EdgeApi } from '../../src/lib/edgeApi';

const roomA = {
  roomId: 'room-a',
  status: 'live',
  room: {
    id: 'room-a',
    code: 'ABCDEFGHJKMNPQRS',
    name: 'Room A',
    status: 'live',
    guestControlLocked: false,
    guestPlaybackLocked: true,
    createdAt: '2026-10-18T00:00:00Z',
  },
  viewer: { memberId: 'm1', displayName: 'Guest', role: 'guest' },
  roster: [],
  queue: [],
  playback: { currentSongId: null, currentVideoId: null, positionSeconds: 0, isPlaying: false, updatedAt: null },
  events: [],
};

beforeEach(() => {
  localStorage.clear();
  saveGuestToken('room-a', 'guest-a');
  saveGuestToken('room-b', 'guest-b');
});

afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe('room data isolation', () => {
  it('keeps cached room data offline but restores the latest room before an ended response', async () => {
    const refreshed = {
      ...roomA,
      room: { ...roomA.room, code: 'QRSTABCDEFGHJKMN', name: 'Updated room' },
      roster: [{ memberId: 'm2', role: 'guest', displayName: 'Alex', online: true }],
    };
    let reads = 0;
    const api: EdgeApi = {
      invoke: (async (name: string) => {
        if (name === 'touch-member') return {};
        if (name === 'guest-room-read') {
          reads += 1;
          if (reads === 2 || reads === 3) {
            throw new RoomApiError('NETWORK_ERROR', 0, 'Network unavailable');
          }
          if (reads === 4) return refreshed;
          if (reads === 5) return { roomId: 'room-a', status: 'ended' };
          return roomA;
        }
        return {};
      }) as unknown as EdgeApi['invoke'],
    };
    const wrapper = ({ children }: { children: ReactNode }) => createElement(RoomApiProvider, { api, children });
    const { result, unmount } = renderHook(() => useRoomData('room-a', 'guest'), { wrapper });
    try {
      await waitFor(() => expect(result.current.connection).toBe('live'));
      expect(result.current.data?.room?.code).toBe(roomA.room.code);

      await act(async () => { await result.current.refresh(); });
      expect(result.current.connection).toBe('live'); // one transient failure
      await act(async () => { await result.current.refresh(); });
      expect(result.current.connection).toBe('offline');
      expect(result.current.data?.room?.code).toBe(roomA.room.code);

      await act(async () => { await result.current.refresh(); });
      expect(result.current.connection).toBe('live');
      expect(result.current.data?.room?.code).toBe(refreshed.room.code);
      expect(result.current.restoredAt).not.toBeNull();

      await act(async () => { await result.current.refresh(); });
      expect(result.current.data?.status).toBe('ended');
      expect(result.current.data?.room).toBeUndefined();
      expect(result.current.error).toBeNull();
    } finally {
      unmount();
    }
  });
  it('does not leave room A data visible when room B cannot be read', async () => {
    const api: EdgeApi = {
      invoke: (async (name: string, body: unknown) => {
        if (name === 'touch-member') {
          return {};
        }
        if (name === 'guest-room-read' && (body as { roomId?: string }).roomId === 'room-a') {
          return roomA;
        }
        throw new RoomApiError('NETWORK_ERROR', 0, 'The room service could not be reached');
      }) as unknown as EdgeApi['invoke'],
    };

    const wrapper = ({ children }: { children: ReactNode }) => createElement(
      RoomApiProvider,
      { api, children },
    );
    const { result, rerender, unmount } = renderHook(
      (props: { roomId: string }) => useRoomData(props.roomId, 'guest'),
      { initialProps: { roomId: 'room-a' }, wrapper },
    );

    await waitFor(() => {
      expect(result.current.data?.roomId).toBe('room-a');
    });

    rerender({ roomId: 'room-b' });

    await waitFor(() => {
      expect(result.current.data).toBeNull();
      expect(result.current.error).toContain('could not be reached');
    });

    unmount();
  });

  it('closes the view when an abandoned room has been removed', async () => {
    let reads = 0;
    const api: EdgeApi = {
      invoke: (async (name: string) => {
        if (name === 'touch-member') {
          return {};
        }
        if (name === 'guest-room-read') {
          reads += 1;
          if (reads === 1) {
            return roomA;
          }
          throw new RoomApiError('ROOM_NOT_FOUND', 404, 'No room uses that code');
        }
        throw new RoomApiError('NETWORK_ERROR', 0, 'The room service could not be reached');
      }) as unknown as EdgeApi['invoke'],
    };

    const wrapper = ({ children }: { children: ReactNode }) => createElement(
      RoomApiProvider,
      { api, children },
    );
    const { result, unmount } = renderHook(() => useRoomData('room-a', 'guest'), { wrapper });

    await waitFor(() => {
      expect(result.current.data?.roomId).toBe('room-a');
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.data).toEqual({ roomId: 'room-a', status: 'ended' });
    expect(result.current.error).toBeNull();
    expect(result.current.connection).toBe('live');
    unmount();
  });

  it('serializes refreshes instead of overlapping reads', async () => {
    const pending: Array<(value: unknown) => void> = [];
    let inFlightReads = 0;
    let maxConcurrentReads = 0;
    const api: EdgeApi = {
      invoke: (async (name: string) => {
        if (name === 'touch-member') {
          return {};
        }
        if (name === 'guest-room-read') {
          inFlightReads += 1;
          maxConcurrentReads = Math.max(maxConcurrentReads, inFlightReads);
          return new Promise((resolve) => {
            pending.push((value) => {
              inFlightReads -= 1;
              resolve(value);
            });
          });
        }
        throw new RoomApiError('NETWORK_ERROR', 0, 'The room service could not be reached');
      }) as unknown as EdgeApi['invoke'],
    };

    const wrapper = ({ children }: { children: ReactNode }) => createElement(
      RoomApiProvider,
      { api, children },
    );
    const { result, unmount } = renderHook(
      () => useRoomData('room-a', 'guest'),
      { wrapper },
    );

    await waitFor(() => {
      expect(pending.length).toBe(1);
    });

    act(() => {
      void result.current.refresh();
    });
    // The extra refresh is queued, not sent while a read is already pending.
    await Promise.resolve();
    expect(pending.length).toBe(1);
    expect(maxConcurrentReads).toBe(1);

    await act(async () => {
      pending[0](roomA);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(pending.length).toBe(2);
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.data?.roomId).toBe('room-a');

    await act(async () => {
      pending[1](roomA);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.data?.roomId).toBe('room-a');
    });
    expect(maxConcurrentReads).toBe(1);

    unmount();
  });

  it('finishes a slow initial read despite StrictMode and multiple polling ticks', async () => {
    vi.useFakeTimers();
    const pending: Array<(value: unknown) => void> = [];
    const api: EdgeApi = {
      invoke: (async (name: string) => {
        if (name === 'touch-member') return {};
        return new Promise((resolve) => pending.push(resolve));
      }) as unknown as EdgeApi['invoke'],
    };
    const wrapper = ({ children }: { children: ReactNode }) => createElement(
      StrictMode,
      null,
      createElement(RoomApiProvider, { api, children }),
    );
    const { result, unmount } = renderHook(() => useRoomData('room-a', 'guest'), { wrapper });

    try {
      expect(pending).toHaveLength(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
      expect(pending).toHaveLength(1);
      expect(result.current.loading).toBe(true);

      await act(async () => { pending[0](roomA); });
      expect(result.current.loading).toBe(false);
      expect(result.current.data?.roomId).toBe('room-a');

      await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
      expect(pending).toHaveLength(2);
      await act(async () => { pending[1](roomA); });
    } finally {
      unmount();
    }
  });

  it('does not let an old room read consume the new room refresh queue', async () => {
    const pending: Array<{ roomId: string; resolve: (value: unknown) => void }> = [];
    const api: EdgeApi = {
      invoke: (async (name: string, body: unknown) => {
        if (name === 'touch-member') return {};
        const { roomId } = body as { roomId: string };
        return new Promise((resolve) => pending.push({ roomId, resolve }));
      }) as unknown as EdgeApi['invoke'],
    };
    const wrapper = ({ children }: { children: ReactNode }) => createElement(
      RoomApiProvider,
      { api, children },
    );
    const { result, rerender, unmount } = renderHook(
      (props: { roomId: string }) => useRoomData(props.roomId, 'guest'),
      { initialProps: { roomId: 'room-a' }, wrapper },
    );

    try {
      expect(pending.map((read) => read.roomId)).toEqual(['room-a']);
      rerender({ roomId: 'room-b' });
      expect(pending.map((read) => read.roomId)).toEqual(['room-a', 'room-b']);
      act(() => { void result.current.refresh(); });

      await act(async () => { pending[0].resolve(roomA); });
      expect(result.current.loading).toBe(true);
      expect(result.current.data).toBeNull();
      expect(pending.map((read) => read.roomId)).toEqual(['room-a', 'room-b']);

      const roomB = { ...roomA, roomId: 'room-b', room: { ...roomA.room, id: 'room-b' } };
      await act(async () => { pending[1].resolve(roomB); });
      expect(result.current.loading).toBe(false);
      expect(result.current.data?.roomId).toBe('room-b');
      expect(pending.map((read) => read.roomId)).toEqual(['room-a', 'room-b', 'room-b']);
      await act(async () => { pending[2].resolve(roomB); });
    } finally {
      unmount();
    }
  });

  it('stops polling once the room pass is revoked', async () => {
    vi.useFakeTimers();
    let reads = 0;
    const api: EdgeApi = {
      invoke: (async (name: string) => {
        if (name === 'touch-member') {
          return {};
        }
        if (name === 'guest-room-read') {
          reads += 1;
          if (reads === 1) {
            return roomA;
          }
          throw new RoomApiError('UNAUTHORIZED', 401, 'That room pass is no longer valid');
        }
        throw new RoomApiError('NETWORK_ERROR', 0, 'The room service could not be reached');
      }) as unknown as EdgeApi['invoke'],
    };

    const wrapper = ({ children }: { children: ReactNode }) => createElement(
      RoomApiProvider,
      { api, children },
    );
    const { result, unmount } = renderHook(() => useRoomData('room-a', 'guest'), { wrapper });

    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(result.current.data?.roomId).toBe('room-a');

      await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
      expect(result.current.data).toBeNull();
      expect(result.current.error).toContain('no longer valid');
      const readsAfterRevocation = reads;
      expect(readsAfterRevocation).toBe(2);

      await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
      expect(reads).toBe(readsAfterRevocation);
    } finally {
      unmount();
    }
  });

  it('does not wait for a slow heartbeat before displaying the room', async () => {
    let resolveTouch: (value: unknown) => void = () => undefined;
    const api: EdgeApi = {
      invoke: (async (name: string) => {
        if (name === 'touch-member') {
          return new Promise((resolve) => { resolveTouch = resolve; });
        }
        return roomA;
      }) as unknown as EdgeApi['invoke'],
    };
    const wrapper = ({ children }: { children: ReactNode }) => createElement(
      RoomApiProvider,
      { api, children },
    );
    const { result, unmount } = renderHook(() => useRoomData('room-a', 'guest'), { wrapper });

    try {
      await waitFor(() => { expect(result.current.loading).toBe(false); });
      expect(result.current.data?.roomId).toBe('room-a');
    } finally {
      await act(async () => { resolveTouch({}); });
      unmount();
    }
  });

  it('sends a throttled heartbeat while hidden without reading the room', async () => {
    let now = 1_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const hiddenDescriptor = Object.getOwnPropertyDescriptor(document, 'hidden');
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });

    let touches = 0;
    let reads = 0;
    const api: EdgeApi = {
      invoke: (async (name: string) => {
        if (name === 'touch-member') {
          touches += 1;
          return {};
        }
        if (name === 'guest-room-read') {
          reads += 1;
          return roomA;
        }
        throw new RoomApiError('NETWORK_ERROR', 0, 'The room service could not be reached');
      }) as unknown as EdgeApi['invoke'],
    };

    const wrapper = ({ children }: { children: ReactNode }) => createElement(
      RoomApiProvider,
      { api, children },
    );
    const { result, unmount } = renderHook(() => useRoomData('room-a', 'guest'), { wrapper });

    try {
      await waitFor(() => {
        expect(result.current.data?.roomId).toBe('room-a');
      });
      expect(touches).toBe(1);
      expect(reads).toBe(1);

      now += 31_000;
      await act(async () => {
        await result.current.refresh();
      });
      expect(touches).toBe(2);
      expect(reads).toBe(1);

      await act(async () => {
        await result.current.refresh();
      });
      expect(touches).toBe(2);
      expect(reads).toBe(1);
    } finally {
      nowSpy.mockRestore();
      if (hiddenDescriptor === undefined) {
        delete (document as unknown as Record<string, unknown>).hidden;
      } else {
        Object.defineProperty(document, 'hidden', hiddenDescriptor);
      }
      unmount();
    }
  });
});
