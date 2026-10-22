import { beforeEach, describe, expect, it } from 'vitest';
import { reportPlaybackPosition } from '../../src/features/playback/playbackApi';
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
});
