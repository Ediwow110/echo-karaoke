import { describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn<(text: string, params: unknown[]) => Promise<unknown[]>>() }));

vi.mock('../../server/db/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/db/client.js')>();
  return { ...actual, serviceDatabase: () => ({ query: db.query }) };
});

import { setAdmissions } from '../../server/operations/admission';
import { requireHostAccess } from '../../server/operations/catalogAccess';

vi.mock('../../server/operations/catalogAccess', () => ({
  requireHostAccess: vi.fn(async () => undefined),
}));

const ROOM_ID = '11111111-1111-4111-8111-111111111111';
const CALLER = { userId: '33333333-3333-4333-8333-333333333333', accessToken: 'token' };
const HOST_TOKEN = 'h'.repeat(32);

function request(headers: Record<string, string>, body: unknown = { roomId: ROOM_ID, locked: true }): Request {
  return new Request('http://localhost/api/set-admissions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('the door lock', () => {
  it('refuses without a host pass before touching the database', async () => {
    db.query.mockReset();
    await expect(setAdmissions(request({}), CALLER as never)).rejects.toMatchObject({ status: 403 });
    expect(db.query).not.toHaveBeenCalled();
    expect(requireHostAccess).not.toHaveBeenCalled();
  });

  it('refuses a host pass too short to be one', async () => {
    db.query.mockReset();
    await expect(setAdmissions(request({ 'x-room-host-token': 'h'.repeat(31) }), CALLER as never))
      .rejects.toMatchObject({ status: 403 });
    expect(db.query).not.toHaveBeenCalled();
    expect(requireHostAccess).not.toHaveBeenCalled();
  });

  it('closes the door through the database function', async () => {
    db.query.mockReset();
    vi.mocked(requireHostAccess).mockClear();
    db.query.mockResolvedValue([{ result: { roomId: ROOM_ID, admissionsLocked: true } }]);
    const response = await setAdmissions(request({ 'x-room-host-token': HOST_TOKEN }), CALLER as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ roomId: ROOM_ID, admissionsLocked: true });
    expect(requireHostAccess).toHaveBeenCalledWith(CALLER, ROOM_ID, HOST_TOKEN);
    expect(String(db.query.mock.calls[0]?.[0])).toContain('room_set_admissions');
    expect(db.query.mock.calls[0]?.[1]).toEqual([ROOM_ID, CALLER.userId, HOST_TOKEN, true]);
  });

  it('refuses a door setting that is missing or not a boolean', async () => {
    db.query.mockReset();
    await expect(setAdmissions(
      request({ 'x-room-host-token': HOST_TOKEN }, { roomId: ROOM_ID }),
      CALLER as never,
    )).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    await expect(setAdmissions(
      request({ 'x-room-host-token': HOST_TOKEN }, { roomId: ROOM_ID, locked: 'yes' }),
      CALLER as never,
    )).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(db.query).not.toHaveBeenCalled();
  });
});
