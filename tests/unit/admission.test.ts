import { describe, expect, it, vi } from 'vitest';
import { HttpError } from '../../server/operations/errors';

const db = vi.hoisted(() => ({ query: vi.fn<(text: string, params: unknown[]) => Promise<unknown[]>>() }));

vi.mock('../../server/db/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/db/client.js')>();
  return { ...actual, serviceDatabase: () => ({ query: db.query }) };
});

import { approveMember, rejectMember } from '../../server/operations/admission';
import { requireHostAccess } from '../../server/operations/catalogAccess';

vi.mock('../../server/operations/catalogAccess', () => ({
  requireHostAccess: vi.fn(async () => undefined),
}));

const ROOM_ID = '11111111-1111-4111-8111-111111111111';
const MEMBER_ID = '22222222-2222-4222-8222-222222222222';
const CALLER = { userId: '33333333-3333-4333-8333-333333333333', accessToken: 'token' };
const HOST_TOKEN = 'h'.repeat(32);

// Both database functions take (room, caller, host pass, member) in that order,
// so the params array is asserted position by position: swapping hostToken and
// memberId would still satisfy a check of the SQL text alone.
const ADMISSION_PARAMS = [ROOM_ID, CALLER.userId, HOST_TOKEN, MEMBER_ID];

function request(headers: Record<string, string>, body: unknown = { roomId: ROOM_ID, memberId: MEMBER_ID }): Request {
  return new Request('http://localhost/api/approve-member', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('admission operations', () => {
  it('refuses without a host pass before touching the database', async () => {
    db.query.mockReset();
    await expect(approveMember(request({}), CALLER as never)).rejects.toMatchObject({ status: 403 });
    expect(db.query).not.toHaveBeenCalled();
    expect(requireHostAccess).not.toHaveBeenCalled();
  });

  it('refuses a host pass too short to be one', async () => {
    db.query.mockReset();
    await expect(approveMember(request({ 'x-room-host-token': 'h'.repeat(31) }), CALLER as never))
      .rejects.toMatchObject({ status: 403 });
    expect(db.query).not.toHaveBeenCalled();
    expect(requireHostAccess).not.toHaveBeenCalled();
  });

  it('admits through the database function and returns the new door', async () => {
    db.query.mockReset();
    db.query.mockResolvedValue([{ result: { memberId: MEMBER_ID, displayName: 'Waiting Guest', door: [] } }]);
    const response = await approveMember(request({ 'x-room-host-token': HOST_TOKEN }), CALLER as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ memberId: MEMBER_ID, displayName: 'Waiting Guest', door: [] });
    expect(requireHostAccess).toHaveBeenCalledWith(CALLER, ROOM_ID, HOST_TOKEN);
    expect(String(db.query.mock.calls[0]?.[0])).toContain('room_approve_member');
    expect(db.query.mock.calls[0]?.[1]).toEqual(ADMISSION_PARAMS);
  });

  it('maps a denied grant to a failure rather than an empty success', async () => {
    db.query.mockReset();
    db.query.mockRejectedValue(new Error('permission denied for function room_reject_member'));
    await expect(rejectMember(request({ 'x-room-host-token': HOST_TOKEN }), CALLER as never))
      .rejects.toBeInstanceOf(HttpError);
    expect(String(db.query.mock.calls[0]?.[0])).toContain('room_reject_member');
    expect(db.query.mock.calls[0]?.[1]).toEqual(ADMISSION_PARAMS);
  });
});
