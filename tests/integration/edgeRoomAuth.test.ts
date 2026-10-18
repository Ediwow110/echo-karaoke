import { describe, expect, it } from 'vitest';

declare const process: { env: Record<string, string | undefined> };

const BASE_URL = process.env.LOCAL_SUPABASE_URL ?? '';
const ANON_KEY = process.env.LOCAL_SUPABASE_ANON_KEY ?? '';
const runsLocally = BASE_URL.length > 0 && ANON_KEY.length > 0;

type FnResult = {
  status: number;
  body: Record<string, unknown>;
};

async function anonymousSession(): Promise<string> {
  const response = await fetch(BASE_URL + '/auth/v1/signup', {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: 'Bearer ' + ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  const payload = (await response.json()) as { access_token?: string };
  expect(typeof payload.access_token).toBe('string');
  return payload.access_token as string;
}

async function callFunction(
  name: string,
  options: { session?: string; roomHeader?: string; roomToken?: string; body: unknown },
): Promise<FnResult> {
  const headers: Record<string, string> = {
    apikey: ANON_KEY,
    'Content-Type': 'application/json',
  };
  if (options.session !== undefined) headers.Authorization = 'Bearer ' + options.session;
  if (options.roomHeader !== undefined && options.roomToken !== undefined) {
    headers[options.roomHeader] = options.roomToken;
  }

  const response = await fetch(BASE_URL + '/functions/v1/' + name, {
    method: 'POST',
    headers,
    body: JSON.stringify(options.body),
  });

  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = { raw: text };
  }
  return { status: response.status, body };
}

describe.skipIf(!runsLocally)('Edge Function room authorization', () => {
  it('rejects requests without a session and without a room token', async () => {
    const noSession = await callFunction('create-room', { body: { displayName: 'Nobody' } });
    expect(noSession.status).toBe(401);

    const hostSession = await anonymousSession();
    const created = await callFunction('create-room', {
      session: hostSession,
      body: { displayName: 'Host One' },
    });
    expect(created.status).toBe(201);

    const roomId = created.body.roomId as string;
    const missingToken = await callFunction('guest-room-read', {
      session: hostSession,
      body: { roomId },
    });
    expect(missingToken.status).toBe(401);
  });

  it('scopes a guest token to one room, one member and one Auth user', async () => {
    const hostSession = await anonymousSession();
    const guestSession = await anonymousSession();

    const created = await callFunction('create-room', {
      session: hostSession,
      body: { displayName: 'Host Two' },
    });
    expect(created.status).toBe(201);

    const roomId = created.body.roomId as string;
    const code = created.body.roomCode as string;
    const hostGuestToken = created.body.guestToken as string;

    const live = await callFunction('guest-room-read', {
      session: hostSession,
      roomHeader: 'x-room-guest-token',
      roomToken: hostGuestToken,
      body: { roomId },
    });
    expect(live.status).toBe(200);
    expect(live.body.status).toBe('live');

    const wrongToken = await callFunction('guest-room-read', {
      session: hostSession,
      roomHeader: 'x-room-guest-token',
      roomToken: 'x'.repeat(43),
      body: { roomId },
    });
    expect(wrongToken.status).toBe(401);

    const otherUser = await callFunction('guest-room-read', {
      session: guestSession,
      roomHeader: 'x-room-guest-token',
      roomToken: hostGuestToken,
      body: { roomId },
    });
    expect(otherUser.status).toBe(401);

    const joined = await callFunction('join-room', {
      session: guestSession,
      body: { code, displayName: 'Guest Two' },
    });
    expect(joined.status).toBe(200);

    const roster = await callFunction('guest-room-read', {
      session: guestSession,
      roomHeader: 'x-room-guest-token',
      roomToken: joined.body.guestToken as string,
      body: { roomId },
    });
    expect(roster.status).toBe(200);
    expect((roster.body.roster as unknown[]).length).toBe(2);
  });

  it('requires the host token for host reads and commands', async () => {
    const hostSession = await anonymousSession();
    const created = await callFunction('create-room', {
      session: hostSession,
      body: { displayName: 'Host Three' },
    });
    const roomId = created.body.roomId as string;
    const hostToken = created.body.hostToken as string;
    const guestToken = created.body.guestToken as string;

    const hostRead = await callFunction('host-room-read', {
      session: hostSession,
      roomHeader: 'x-room-host-token',
      roomToken: hostToken,
      body: { roomId },
    });
    expect(hostRead.status).toBe(200);

    const guestAsHost = await callFunction('host-room-read', {
      session: hostSession,
      roomHeader: 'x-room-host-token',
      roomToken: guestToken,
      body: { roomId },
    });
    expect(guestAsHost.status).toBe(401);

    const locked = await callFunction('host-command', {
      session: hostSession,
      roomHeader: 'x-room-host-token',
      roomToken: hostToken,
      body: { roomId, action: 'lock' },
    });
    expect(locked.status).toBe(200);
    expect(locked.body.guestControlLocked).toBe(true);

    const badAction = await callFunction('host-command', {
      session: hostSession,
      roomHeader: 'x-room-host-token',
      roomToken: hostToken,
      body: { roomId, action: 'explode' },
    });
    expect(badAction.status).toBe(400);
  });

  it('reports unknown and ended rooms distinctly', async () => {
    const hostSession = await anonymousSession();
    const guestSession = await anonymousSession();

    const created = await callFunction('create-room', {
      session: hostSession,
      body: { displayName: 'Host Four' },
    });
    const roomId = created.body.roomId as string;
    const code = created.body.roomCode as string;
    const hostToken = created.body.hostToken as string;
    const guestToken = created.body.guestToken as string;

    const unknown = await callFunction('join-room', {
      session: guestSession,
      body: { code: 'AAAAAAAABBBBBBBB', displayName: 'Nobody' },
    });
    expect(unknown.status).toBe(404);
    expect((unknown.body.error as { code: string }).code).toBe('ROOM_NOT_FOUND');

    const ended = await callFunction('host-command', {
      session: hostSession,
      roomHeader: 'x-room-host-token',
      roomToken: hostToken,
      body: { roomId, action: 'end' },
    });
    expect(ended.status).toBe(200);
    expect(ended.body.status).toBe('ended');

    const endedJoin = await callFunction('join-room', {
      session: guestSession,
      body: { code, displayName: 'Late Guest' },
    });
    expect(endedJoin.status).toBe(409);
    expect((endedJoin.body.error as { code: string }).code).toBe('ROOM_ENDED');

    const endedRead = await callFunction('guest-room-read', {
      session: hostSession,
      roomHeader: 'x-room-guest-token',
      roomToken: guestToken,
      body: { roomId },
    });
    expect(endedRead.status).toBe(200);
    expect(endedRead.body.status).toBe('ended');
    expect(endedRead.body.queue).toBeUndefined();
    expect(endedRead.body.roster).toBeUndefined();
  });
});
