import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
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
});

describe('room data isolation', () => {
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

  it('does not clear loading when a superseded read settles', async () => {
    const pending: Array<(value: unknown) => void> = [];
    const api: EdgeApi = {
      invoke: (async (name: string) => {
        if (name === 'touch-member') {
          return {};
        }
        if (name === 'guest-room-read') {
          return new Promise((resolve) => pending.push(resolve));
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
    await waitFor(() => {
      expect(pending.length).toBe(2);
    });

    await act(async () => {
      pending[0](roomA);
      await Promise.resolve();
    });
    expect(result.current.loading).toBe(true);

    await act(async () => {
      pending[1](roomA);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.data?.roomId).toBe('room-a');
    });

    unmount();
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
