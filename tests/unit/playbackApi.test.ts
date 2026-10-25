import { beforeEach, describe, expect, it } from 'vitest';
import { reportPlaybackPosition, sendPlaybackCommand } from '../../src/features/playback/playbackApi';
import { saveHostToken } from '../../src/features/rooms/tokenStore';
import type { EdgeApi } from '../../src/lib/edgeApi';

describe('playback position reporting', () => {
  beforeEach(() => {
    localStorage.clear();
    saveHostToken('room-a', 'host-pass');
  });

  it('sends finite numbers when the player reports non-finite values', async () => {
    const bodies: unknown[] = [];
    const api = {
      invoke: async (_name: string, body: unknown) => {
        bodies.push(body);
        return {};
      },
    } as unknown as EdgeApi;

    await reportPlaybackPosition(api, 'room-a', Number.NaN, Number.NaN, 'song-a');

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ positionSeconds: 0, durationSeconds: null, songId: 'song-a' });
  });

  it('binds automatic next to its original song without changing manual next', async () => {
    const bodies: unknown[] = [];
    const api = { invoke: async (_name: string, body: unknown) => {
      bodies.push(body);
      return { roomId: 'room-a', status: 'live', playback: {} };
    } } as unknown as EdgeApi;

    await sendPlaybackCommand(api, 'room-a', 'next', undefined, '11111111-1111-1111-1111-111111111111');
    await sendPlaybackCommand(api, 'room-a', 'next');

    expect(bodies[0]).toMatchObject({
      action: 'next',
      expectedSongId: '11111111-1111-1111-1111-111111111111',
    });
    expect(bodies[1]).toEqual({ roomId: 'room-a', action: 'next' });
  });
});
