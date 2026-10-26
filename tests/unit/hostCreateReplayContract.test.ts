import { beforeEach, describe, expect, it, vi } from 'vitest';

// Purely mocked server-to-SQL boundary. No real database calls.
// These tests characterize CURRENT behavior, not a finished idempotency fix.
const state = vi.hoisted(() => ({
  operations: [] as Array<{ sql: string; params: unknown[] }>,
  failFirstCollision: false,
  failDatabase: false,
}));

vi.mock('../../server/operations/sweep.js', () => ({
  sweepAbandonedRooms: async () => undefined,
  sweepEndedRooms: async () => undefined,
}));
vi.mock('../../server/db/client.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/db/client.js')>();
  return {
    ...original,
    serviceDatabase: () => ({
      query: async (sql: string, params: unknown[]) => {
        state.operations.push({ sql, params });
        if (state.failDatabase) {
          throw { message: 'unrecognized database write failed', code: 'GENERIC_ERROR' };
        }
        if (state.failFirstCollision && state.operations.length === 1) {
          throw { code: '23505', message: 'unique room code collision' };
        }
        const roomSequence = String(state.operations.length).padStart(12, '0');
        return [{ result: {
          roomId: '550e8400-e29b-41d4-a716-' + roomSequence,
          roomCode: params[0],
          roomName: params[5],
          memberId: '3a1ee27f-a539-4190-9250-bdc14ff631e0',
          displayName: params[2],
          role: 'host',
          guestToken: params[3],
          hostToken: params[4],
        } }];
      },
    }),
  };
});

import { createRoom } from '../../server/operations/createRoom';

const caller = { userId: 'same-anonymous-user', accessToken: 'test-jwt' };
function request(id = 'same-client-request-id', extras: Record<string, unknown> = {}) {
  return new Request('https://kara-echo.example/api/create-room', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-request-id': id },
    body: JSON.stringify({ displayName: 'Alex', roomName: 'Singalong', guestsCanAdd: true, ...extras }),
  });
}

describe('current host room creation replay contract (mock SQL)', () => {
  beforeEach(() => {
    state.operations.length = 0;
    state.failFirstCollision = false;
    state.failDatabase = false;
  });

  it('currently executes a second SQL create for identical same-user requests, even with the same client request id', async () => {
    const first = await createRoom(request(), caller);
    const second = await createRoom(request(), caller);
    const firstRoom = await first.json() as { roomId: string; roomCode: string; hostToken: string };
    const secondRoom = await second.json() as { roomId: string; roomCode: string; hostToken: string };

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(state.operations).toHaveLength(2);
    expect(state.operations.every((call) => call.sql.includes('public.create_room('))).toBe(true);
    expect(state.operations.map((call) => call.params[1])).toEqual([caller.userId, caller.userId]);
    expect(state.operations.every((call) => call.params.length === 9)).toBe(true);
    expect(firstRoom.roomId).not.toBe(secondRoom.roomId);
    expect(firstRoom.roomCode).not.toBe(secondRoom.roomCode);
    expect(firstRoom.hostToken).not.toBe(secondRoom.hostToken);
    // x-client-request-id is not currently part of the server SQL contract.
    expect(state.operations.some((call) => call.params.includes('same-client-request-id'))).toBe(false);
  });

  it('currently also creates a fresh room for the same request id from a different identity', async () => {
    await createRoom(request(), caller);
    await createRoom(request(), { userId: 'different-anonymous-user', accessToken: 'another-jwt' });
    expect(state.operations).toHaveLength(2);
    expect(state.operations.map((call) => call.params[1])).toEqual([
      'same-anonymous-user', 'different-anonymous-user',
    ]);
  });

  it('uses verified caller identity even when a client forges owner fields in the request body', async () => {
    await createRoom(request('intent-a', {
      userId: 'pretend-admin',
      ownerId: 'pretend-admin',
      role: 'host',
      hostToken: 'attacker-chosen-weak-token',
      guestToken: 'attacker-chosen-weak-guest-token',
    }), caller);
    expect(state.operations).toHaveLength(1);
    const sqlParams = state.operations[0].params;
    expect(sqlParams[1]).toBe(caller.userId);
    expect(sqlParams).not.toContain('pretend-admin');
    expect(sqlParams).not.toContain('attacker-chosen-weak-token');
    expect(sqlParams).not.toContain('attacker-chosen-weak-guest-token');
  });

  it('currently creates a second room after a simulated successful commit with a lost HTTP response', async () => {
    const first = await createRoom(request('same-intent'), caller);
    const firstBody = await first.json() as { roomId: string; hostToken: string };
    // Simulate losing first's HTTP response: client retries rather than
    // receiving the room ID and host capability. No actual network failure
    // or Neon database write happens in this unit test.
    const retry = await createRoom(request('same-intent'), caller);
    const retryBody = await retry.json() as { roomId: string; hostToken: string };
    expect(state.operations).toHaveLength(2);
    expect(retryBody.roomId).not.toBe(firstBody.roomId);
    expect(retryBody.hostToken).not.toBe(firstBody.hostToken);
  });

  it('keeps SQL parameter values out of the SQL statement text', async () => {
    const database = await import('../../server/db/client.js');
    const call = database.operationCall('create_room', ['CODE', caller.userId]);
    expect(call.text).toContain('$1');
    expect(call.text).not.toContain(caller.userId);
    expect(call.text).not.toContain('CODE');
  });

  it('maps an unrecognized SQL failure to a generic error without disclosing the generated passes', async () => {
    state.failDatabase = true;
    let rejected: unknown;
    try {
      await createRoom(request(), caller);
    } catch (error) {
      rejected = error;
    }
    expect(state.operations).toHaveLength(1);
    expect(rejected).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
    const responseMessage = (rejected as Error).message;
    expect(responseMessage).toMatch(/could not be completed/i);
    expect(responseMessage).not.toContain(state.operations[0].params[3] as string);
    expect(responseMessage).not.toContain(state.operations[0].params[4] as string);
  });

  it('generates new tokens on a room-code uniqueness collision rather than replaying a prior response', async () => {
    state.failFirstCollision = true;
    const result = await createRoom(request(), caller);
    expect(result.status).toBe(201);
    expect(state.operations).toHaveLength(2);
    expect(state.operations[0].params[4]).not.toBe(state.operations[1].params[4]);
    expect(state.operations[0].params[3]).not.toBe(state.operations[1].params[3]);
  });
});
