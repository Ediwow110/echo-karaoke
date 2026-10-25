import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ calls: [] as Array<{ name: string; params: unknown[] }> }));
vi.mock('../../server/db/client', () => ({
  operationCall: (name: string, params: unknown[]) => ({ text: name, params }),
  serviceDatabase: () => ({ query: async (name: string, params: unknown[]) => {
    db.calls.push({ name, params });
    return [{ result: { roomId: params[0], status: 'live', playback: {}, advanced: true } }];
  } }),
}));

import { playbackCommand } from '../../server/operations/room';

const roomId = '11111111-1111-1111-1111-111111111111';
const songId = '22222222-2222-2222-2222-222222222222';
const caller = { userId: 'user-123', accessToken: 'token' };
const hostToken = 'h'.repeat(40);
const guestToken = 'g'.repeat(40);

function request(body: unknown, token: 'host' | 'guest' = 'host'): Request {
  return new Request('http://localhost/api/playback-command', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [token === 'host' ? 'x-room-host-token' : 'x-room-guest-token']:
        token === 'host' ? hostToken : guestToken,
    },
    body: JSON.stringify(body),
  });
}

describe('automatic playback advance routing', () => {
  beforeEach(() => { db.calls.length = 0; });

  it('routes an expected song through the host-only atomic advance RPC', async () => {
    const response = await playbackCommand(request({ roomId, action: 'next', expectedSongId: songId }), caller);
    expect(response.status).toBe(200);
    expect(db.calls).toEqual([{
      name: 'playback_next_if_current',
      params: [roomId, caller.userId, hostToken, songId],
    }]);
  });

  it('keeps deliberate manual Skip on the original SQL operation', async () => {
    await playbackCommand(request({ roomId, action: 'next' }), caller);
    expect(db.calls[0]).toEqual({
      name: 'playback_command',
      params: [roomId, caller.userId, null, hostToken, 'next'],
    });
  });

  it('rejects guest automatic next before it can call SQL', async () => {
    await expect(playbackCommand(
      request({ roomId, action: 'next', expectedSongId: songId }, 'guest'), caller,
    )).rejects.toThrow('Only the host');
    expect(db.calls).toHaveLength(0);
  });

  it('rejects a malformed expected song before it reaches SQL', async () => {
    await expect(playbackCommand(
      request({ roomId, action: 'next', expectedSongId: 'bad-id' }), caller,
    )).rejects.toThrow('A song identifier is required');
    expect(db.calls).toHaveLength(0);
  });
});
