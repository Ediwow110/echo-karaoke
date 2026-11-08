import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  query,
  sweepAbandonedRooms,
  sweepEndedRooms,
  roomSweepDue,
} = vi.hoisted(() => ({
  query: vi.fn(),
  sweepAbandonedRooms: vi.fn(),
  sweepEndedRooms: vi.fn(),
  roomSweepDue: vi.fn(),
}));

vi.mock('../../server/db/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/db/client')>();
  return { ...actual, serviceDatabase: () => ({ query }) };
});

vi.mock('../../server/operations/sweep', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/operations/sweep')>();
  return { ...actual, sweepAbandonedRooms, sweepEndedRooms, roomSweepDue };
});

import { createRoom } from '../../server/operations/createRoom';

const caller = { userId: 'user-1', accessToken: 'access-token' };

function createRequest(): Request {
  return new Request('http://localhost/api/create-room', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName: 'Sweep Host' }),
  });
}

beforeEach(() => {
  query.mockReset();
  sweepAbandonedRooms.mockReset().mockResolvedValue(0);
  sweepEndedRooms.mockReset().mockResolvedValue(0);
  roomSweepDue.mockReset().mockResolvedValue(false);
});

describe('room creation cleanup ordering', () => {
  it('does not inspect or run the sweeps when create_room is rate-limited', async () => {
    query.mockRejectedValueOnce({ message: 'ROOM_CREATE_RATE_LIMITED' });

    await expect(createRoom(createRequest(), caller)).rejects.toMatchObject({
      code: 'ROOM_CREATE_RATE_LIMITED',
    });

    expect(roomSweepDue).not.toHaveBeenCalled();
    expect(sweepAbandonedRooms).not.toHaveBeenCalled();
    expect(sweepEndedRooms).not.toHaveBeenCalled();
  });

  it('checks the sweep throttle only after the room exists', async () => {
    query.mockResolvedValueOnce([{ result: { roomId: 'room-1' } }]);
    roomSweepDue.mockResolvedValue(false);

    const response = await createRoom(createRequest(), caller);

    expect(response.status).toBe(201);
    expect(roomSweepDue).toHaveBeenCalledTimes(1);
    expect(sweepAbandonedRooms).not.toHaveBeenCalled();
    expect(sweepEndedRooms).not.toHaveBeenCalled();
  });

  it('runs both sweeps when the throttle allows and the room exists', async () => {
    query.mockResolvedValueOnce([{ result: { roomId: 'room-1' } }]);
    roomSweepDue.mockResolvedValue(true);

    const response = await createRoom(createRequest(), caller);

    expect(response.status).toBe(201);
    expect(sweepAbandonedRooms).toHaveBeenCalledTimes(1);
    expect(sweepEndedRooms).toHaveBeenCalledTimes(1);
  });
});
