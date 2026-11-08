import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  names: [] as string[],
  allowed: true,
}));

vi.mock('../../server/db/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/db/client.js')>();
  return {
    ...actual,
    serviceDatabase: () => ({
      query: async (text: string) => {
        state.names.push(text);
        if (text.includes('consume_rate_limit')) {
          return [{ result: { allowed: state.allowed } }];
        }
        return [{ result: { voted: true } }];
      },
    }),
  };
});

import { voteCommand } from '../../server/operations/room';

const ROOM_ID = '11111111-1111-4111-8111-111111111111';
const SONG_ID = '22222222-2222-4222-8222-222222222222';
const caller = { userId: 'user-1', accessToken: 'access-token' };

function request(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/vote-command', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-room-guest-token': 'g'.repeat(40),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.names = [];
  state.allowed = true;
});

describe('vote request validation', () => {
  it('refuses a malformed song id before charging the vote bucket', async () => {
    await expect(voteCommand(request({ roomId: ROOM_ID, songId: 'not-a-uuid' }), caller))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(state.names.some((text) => text.includes('consume_rate_limit'))).toBe(false);
  });

  it('charges the bucket only for a vote it will attempt', async () => {
    const response = await voteCommand(request({ roomId: ROOM_ID, songId: SONG_ID }), caller);

    expect(response.status).toBe(200);
    const charge = state.names.findIndex((text) => text.includes('consume_rate_limit'));
    const vote = state.names.findIndex((text) => text.includes('vote_toggle'));
    expect(charge).toBeGreaterThanOrEqual(0);
    expect(charge).toBeLessThan(vote);
  });
});
