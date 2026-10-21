import { beforeEach, describe, expect, it } from 'vitest';
import type { EdgeApi } from '../../src/lib/edgeApi';
import { addSong, removeSong, reorderSong } from '../../src/features/queue/queueApi';

type Call = { name: string; body: Record<string, unknown>; tokens: Record<string, string> };

function recorder(): { api: EdgeApi; calls: Call[] } {
  const calls: Call[] = [];
  const api: EdgeApi = {
    invoke: (async (name: string, body: Record<string, unknown>, tokens: Record<string, string>) => {
      calls.push({ name, body, tokens });
      return { songId: 's1', position: 1, title: 'Song' };
    }) as unknown as EdgeApi['invoke'],
  };
  return { api, calls };
}

describe('queue api', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('prefers the host pass when this browser holds one', async () => {
    localStorage.setItem('karaoke.host.room-1', 'host-pass');
    localStorage.setItem('karaoke.guest.room-1', 'guest-pass');
    const { api, calls } = recorder();

    await addSong(api, 'room-1', 'dQw4w9WgXcQ');

    expect(calls[0].name).toBe('queue-command');
    expect(calls[0].body).toEqual({ roomId: 'room-1', action: 'add', kind: 'add', videoId: 'dQw4w9WgXcQ' });
    expect(calls[0].tokens).toEqual({ hostToken: 'host-pass' });
  });

  it('uses the guest pass when this browser is a guest', async () => {
    localStorage.setItem('karaoke.guest.room-2', 'guest-pass');
    const { api, calls } = recorder();

    await removeSong(api, 'room-2', 'song-9');

    expect(calls[0].body).toMatchObject({ action: 'remove', songId: 'song-9' });
    expect(calls[0].tokens).toEqual({ guestToken: 'guest-pass' });
  });

  it('sends the direction when reordering', async () => {
    localStorage.setItem('karaoke.guest.room-3', 'guest-pass');
    const { api, calls } = recorder();

    await reorderSong(api, 'room-3', 'song-2', 'up');

    expect(calls[0].body).toMatchObject({ action: 'reorder', songId: 'song-2', direction: 'up' });
  });

  it('refuses to act without any room pass', async () => {
    const { api, calls } = recorder();

    await expect(addSong(api, 'room-4', 'dQw4w9WgXcQ')).rejects.toThrow(/pass/i);
    expect(calls).toHaveLength(0);
  });
});
