import { beforeEach, describe, expect, it, vi } from 'vitest';

// This test deliberately models only the server -> SQL RPC boundary.
// It does NOT prove deployed SQL semantics or actual Neon credentials.
const state = vi.hoisted(() => ({
  invocations: [] as Array<{ operation: string; params: unknown[] }>,
  currentPass: '' as string,
  peekAllowed: true,
  joinFailure: false,
  consumes: 0,
}));

vi.mock('../../server/db/client.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/db/client.js')>();
  return {
    ...original,
    serviceDatabase: () => ({
      query: async (sql: string, params: unknown[]) => {
        const operation = /select public\.([a-z_]+)\(/.exec(sql)?.[1] ?? '';
        state.invocations.push({ operation, params });
        if (operation === 'peek_daily_rate_limit') {
          return [{ result: { allowed: state.peekAllowed, retryAfterSeconds: 30 } }];
        }
        if (operation === 'consume_daily_rate_limit') {
          state.consumes += 1;
          return [{ result: { allowed: true } }];
        }
        if (operation !== 'join_room') throw new Error('Unexpected mocked SQL operation');
        if (state.joinFailure) throw new Error('ROOM_NOT_FOUND');
        state.currentPass = params[3] as string;
        return [{ result: {
          roomId: '3a1ee27f-a539-4190-9250-bdc14ff631e0',
          roomCode: params[0],
          roomName: 'Test room',
          memberId: '550e8400-e29b-41d4-a716-446655440000',
          displayName: params[2],
          role: 'guest',
          guestToken: state.currentPass,
        } }];
      },
    }),
  };
});

import { joinRoom } from '../../server/operations/room';

function joinRequest(headers: Record<string, string> = {}) {
  return new Request('https://kara-echo.example/api/join-room', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ code: 'ABCDEFGHJKMNPQRS', displayName: 'Jamie' }),
  });
}

describe('guest rejoin contract at the server-to-SQL boundary', () => {
  beforeEach(() => {
    state.invocations.length = 0;
    state.currentPass = '';
    state.peekAllowed = true;
    state.joinFailure = false;
    state.consumes = 0;
  });

  it('sends a new random guest pass on each retry for the same anonymous user', async () => {
    const caller = { userId: 'same-anonymous-user', accessToken: 'test-access' };
    const first = await joinRoom(joinRequest(), caller);
    const firstBody = await first.json() as { guestToken: string };
    const second = await joinRoom(joinRequest(), caller);
    const secondBody = await second.json() as { guestToken: string };

    const joins = state.invocations.filter((call) => call.operation === 'join_room');
    expect(joins).toHaveLength(2);
    expect(joins.map((call) => call.params[1])).toEqual([caller.userId, caller.userId]);
    expect(joins.map((call) => call.params[0])).toEqual(['ABCDEFGHJKMNPQRS', 'ABCDEFGHJKMNPQRS']);
    expect(joins.every((call) => typeof call.params[3] === 'string' && (call.params[3] as string).length >= 32)).toBe(true);
    expect(firstBody.guestToken).not.toBe(secondBody.guestToken);
    // SQL migration 0026 overwrites guest_token_hash on rejoin; the older
    // bearer becomes invalid. A lost second HTTP response cannot be
    // recovered using that older pass without a new server-side contract.
    expect(state.currentPass).toBe(secondBody.guestToken);
    expect(state.consumes, 'a successful join must not spend a failure slot').toBe(0);
  });

  it('blocks a join from a network that has spent its failure budget', async () => {
    state.peekAllowed = false;
    const response = await joinRoom(
      joinRequest({ 'x-forwarded-for': '203.0.113.9' }),
      { userId: 'caller', accessToken: 'test-access' },
    );

    expect(response.status).toBe(429);
    expect(state.invocations.some((call) => call.operation === 'join_room')).toBe(false);
    const peek = state.invocations.find((call) => call.operation === 'peek_daily_rate_limit');
    expect(peek?.params[1]).toBe('join-fail-day');
    expect(String(peek?.params[0])).toMatch(/^join-fail:[0-9a-f]{64}$/);
    expect(String(peek?.params[0]), 'the raw address must not reach the limiter').not.toContain('203.0.113.9');
  });

  it('records a not-found guess without recording a successful join', async () => {
    state.joinFailure = true;
    await expect(joinRoom(
      joinRequest({ 'x-forwarded-for': '203.0.113.9' }),
      { userId: 'caller', accessToken: 'test-access' },
    )).rejects.toMatchObject({ status: 404, code: 'ROOM_NOT_FOUND' });

    expect(state.consumes).toBe(1);
    const consume = state.invocations.find((call) => call.operation === 'consume_daily_rate_limit');
    expect(consume?.params[1]).toBe('join-fail-day');
    expect(String(consume?.params[0]), 'the raw address must not reach the limiter').not.toContain('203.0.113.9');
  });

  it('rejects malformed room codes without issuing the join RPC', async () => {
    await expect(joinRoom(
      new Request('https://kara-echo.example/api/join-room', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: '../bad', displayName: 'Jamie' }),
      }),
      { userId: 'caller', accessToken: 'test-access' },
    )).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(state.invocations).toHaveLength(0);
  });
});
