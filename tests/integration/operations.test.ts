import { createServer, type IncomingMessage, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const BASE = 'http://127.0.0.1:3000';
const runsHere = Boolean(
  process.env.AUTH_DATABASE_URL
  && process.env.DATABASE_URL
  && process.env.BETTER_AUTH_SECRET,
);

if (process.env.CI === 'true' && !runsHere) {
  throw new Error('CI must provide DATABASE_URL, AUTH_DATABASE_URL, and BETTER_AUTH_SECRET for the integration suite.');
}
if (!runsHere) {
  console.warn('Integration suite skipped: set DATABASE_URL, AUTH_DATABASE_URL, and BETTER_AUTH_SECRET.');
}

type Handler = (request: Request) => Promise<Response>;

let handler: Handler | undefined;
let server: Server | undefined;

async function toFetchRequest(request: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = chunks.length > 0 && request.method !== 'GET' && request.method !== 'HEAD'
    ? Buffer.concat(chunks)
    : undefined;
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value !== undefined) {
      headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    }
  }
  return new Request(BASE + (request.url ?? '/'), { method: request.method, headers, body });
}

let signInSequence = 0;

function testNetwork(): string {
  signInSequence += 1;
  return 'test-' + process.pid + '-' + Date.now() + '-' + signInSequence;
}

async function signInResponse(network: string): Promise<Response> {
  return fetch(BASE + '/api/auth/sign-in/anonymous', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: BASE,
      'x-forwarded-for': network,
    },
    body: '{}',
  });
}

async function signIn(): Promise<string> {
  const response = await signInResponse(testNetwork());
  expect(response.status).toBe(200);
  const cookies = response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]);
  const tokenResponse = await fetch(BASE + '/api/auth/token', {
    headers: { cookie: cookies.join('; '), origin: BASE },
  });
  expect(tokenResponse.status).toBe(200);
  const tokenBody = (await tokenResponse.json()) as { token?: string };
  expect(typeof tokenBody.token).toBe('string');
  return tokenBody.token as string;
}

async function call(name: string, token: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(BASE + '/api/' + name, {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + token,
      'content-type': 'application/json',
      origin: BASE,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe.skipIf(!runsHere)('Vercel operation router', () => {
  beforeAll(async () => {
    const entry = (await import('../../api/router')).default;
    handler = (request) => entry.fetch(request);
    server = createServer(async (request, response) => {
      const result = await handler!(await toFetchRequest(request));
      response.statusCode = result.status;
      result.headers.forEach((value, key) => {
        if (key !== 'set-cookie') response.setHeader(key, value);
      });
      const cookies = result.headers.getSetCookie();
      if (cookies.length > 0) response.setHeader('set-cookie', cookies);
      response.end(Buffer.from(await result.arrayBuffer()));
    });
    await new Promise<void>((resolve) => server!.listen(3000, '127.0.0.1', resolve));
  });

  afterAll(async () => {
    if (server !== undefined) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
  });

  it('creates, joins, reads, touches and locks through the router', async () => {
    const hostAuth = await signIn();
    const guestAuth = await signIn();

    const created = await call('create-room', hostAuth, {
      displayName: 'Router Host',
      roomName: 'Router Room',
      guestsCanAdd: true,
      guestsCanControlPlayback: false,
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as {
      roomId?: string;
      roomCode?: string;
      hostToken?: string;
      guestToken?: string;
      role?: string;
    };
    expect(createdBody.roomId).toMatch(/^[0-9a-f-]{36}$/);
    expect(createdBody.roomCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/);
    expect(createdBody.hostToken).toHaveLength(43);
    expect(createdBody.role).toBe('host');
    const roomId = createdBody.roomId as string;

    const joined = await call('join-room', guestAuth, {
      code: createdBody.roomCode,
      displayName: 'Router Guest',
    });
    expect(joined.status).toBe(200);
    const joinedBody = (await joined.json()) as { guestToken?: string };
    expect(joinedBody.guestToken).toHaveLength(43);
    const guestToken = joinedBody.guestToken as string;

    const guestRead = await call('guest-room-read', guestAuth, { roomId }, {
      'x-room-guest-token': guestToken,
    });
    expect(guestRead.status).toBe(200);
    const guestView = (await guestRead.json()) as { status?: string };
    expect(guestView.status).toBe('live');

    const hostRead = await call('host-room-read', hostAuth, { roomId }, {
      'x-room-host-token': createdBody.hostToken as string,
    });
    expect(hostRead.status).toBe(200);
    const hostView = (await hostRead.json()) as { status?: string };
    expect(hostView.status).toBe('live');

    const touched = await call('touch-member', guestAuth, { roomId }, {
      'x-room-guest-token': guestToken,
    });
    expect(touched.status).toBe(200);

    const locked = await call('host-command', hostAuth, { roomId, action: 'lock' }, {
      'x-room-host-token': createdBody.hostToken as string,
    });
    expect(locked.status).toBe(200);

    const unlocked = await call('host-command', hostAuth, { roomId, action: 'unlock' }, {
      'x-room-host-token': createdBody.hostToken as string,
    });
    expect(unlocked.status).toBe(200);

    const queued = await call('queue-command', guestAuth, {
      roomId,
      action: 'add',
      videoId: 'dQw4w9WgXcQ',
    }, {
      'x-room-guest-token': guestToken,
    });
    expect(queued.status).toBe(201);
    const queuedBody = (await queued.json()) as { songId?: string; title?: string };
    expect(typeof queuedBody.songId).toBe('string');
    expect((queuedBody.title ?? '').length).toBeGreaterThan(0);

    const voted = await call('vote-command', guestAuth, {
      roomId,
      songId: queuedBody.songId,
    }, {
      'x-room-guest-token': guestToken,
    });
    expect(voted.status).toBe(200);

    const played = await call('playback-command', hostAuth, {
      roomId,
      action: 'play',
    }, {
      'x-room-host-token': createdBody.hostToken as string,
    });
    expect(played.status).toBe(200);

    const reported = await call('playback-report', hostAuth, {
      roomId,
      positionSeconds: 1,
      durationSeconds: 30,
      songId: queuedBody.songId,
    }, {
      'x-room-host-token': createdBody.hostToken as string,
    });
    expect(reported.status).toBe(200);

    const next = await call('playback-command', hostAuth, {
      roomId,
      action: 'next',
    }, {
      'x-room-host-token': createdBody.hostToken as string,
    });
    expect(next.status).toBe(200);

    const removed = await call('queue-command', hostAuth, {
      roomId,
      action: 'remove',
      songId: queuedBody.songId,
    }, {
      'x-room-host-token': createdBody.hostToken as string,
    });
    expect(removed.status).toBe(200);

    // A configured key would bill real YouTube quota on this call; the unit
    // suites cover the keyed path against a mocked upstream.
    delete process.env.YOUTUBE_API_KEY;

    const search = await call('youtube-search', guestAuth, {
      roomId,
      query: 'abba',
    }, {
      'x-room-guest-token': guestToken,
    });
    expect(search.status).toBe(200);
    const searchBody = (await search.json()) as { available?: boolean; results?: unknown[] };
    expect(searchBody.available).toBe(false);
    expect(searchBody.results).toEqual([]);

    const popular = await call('youtube-popular', guestAuth, { roomId }, {
      'x-room-guest-token': guestToken,
    });
    expect(popular.status).toBe(200);
    const popularBody = (await popular.json()) as { available?: boolean; results?: unknown[] };
    expect(popularBody.available).toBe(false);
    expect(popularBody.results).toEqual([]);

    const suggest = await call('youtube-suggest', guestAuth, {
      roomId,
      query: 'a',
    }, {
      'x-room-guest-token': guestToken,
    });
    expect(suggest.status).toBe(400);
  });

  it('serves auth and operations through the Vercel rewrite', async () => {
    const jwks = await fetch(BASE + '/api/router?path=auth/jwks');
    expect(jwks.status).toBe(200);
    const keys = (await jwks.json()) as { keys?: unknown[] };
    expect(Array.isArray(keys.keys)).toBe(true);
    expect((keys.keys ?? []).length).toBeGreaterThan(0);

    const hostAuth = await signIn();
    const created = await fetch(BASE + '/api/router?path=create-room', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + hostAuth,
        'content-type': 'application/json',
        origin: BASE,
      },
      body: JSON.stringify({ displayName: 'Rewrite Host' }),
    });
    expect(created.status).toBe(201);

    const missing = await fetch(BASE + '/api/router?path=__preview_check__', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE },
      body: '{}',
    });
    expect(missing.status).toBe(404);
    expect(missing.headers.get('content-type')).toContain('application/json');
  });

  it('keeps a host heartbeat after the auth session is replaced', async () => {
    const original = await signIn();
    const created = await call('create-room', original, { displayName: 'Session Host' });
    expect(created.status).toBe(201);
    const room = (await created.json()) as { roomId: string; hostToken: string };

    const replacement = await signIn();
    const touched = await call('touch-member', replacement, { roomId: room.roomId }, {
      'x-room-host-token': room.hostToken,
    });
    expect(touched.status).toBe(200);

    const read = await call('host-room-read', replacement, { roomId: room.roomId }, {
      'x-room-host-token': room.hostToken,
    });
    expect(read.status).toBe(200);
  });

  it('limits anonymous sign-ins per network', async () => {
    const previous = process.env.ANON_SIGNIN_LIMIT_PER_HOUR;
    process.env.ANON_SIGNIN_LIMIT_PER_HOUR = '2';
    try {
      const network = 'test-limit-' + Date.now();
      expect((await signInResponse(network)).status).toBe(200);
      expect((await signInResponse(network)).status).toBe(200);
      const denied = await signInResponse(network);
      expect(denied.status).toBe(429);
      expect(await denied.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
      expect(denied.headers.get('retry-after')).toMatch(/^\d+$/);
    } finally {
      if (previous === undefined) {
        delete process.env.ANON_SIGNIN_LIMIT_PER_HOUR;
      } else {
        process.env.ANON_SIGNIN_LIMIT_PER_HOUR = previous;
      }
    }
  });

  it('does not spend the sign-in quota on a cross-site request', async () => {
    const previous = process.env.ANON_SIGNIN_LIMIT_PER_HOUR;
    process.env.ANON_SIGNIN_LIMIT_PER_HOUR = '1';
    try {
      const network = 'test-origin-' + Date.now();
      const crossSite = await fetch(BASE + '/api/auth/sign-in/anonymous', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://evil.example',
          'x-forwarded-for': network,
        },
        body: '{}',
      });
      expect(crossSite.status).toBe(403);

      const sameSite = await signInResponse(network);
      expect(sameSite.status).toBe(200);
    } finally {
      if (previous === undefined) {
        delete process.env.ANON_SIGNIN_LIMIT_PER_HOUR;
      } else {
        process.env.ANON_SIGNIN_LIMIT_PER_HOUR = previous;
      }
    }
  });

  it('rejects a new guest when the room is full', async () => {
    const previous = process.env.ROOM_MEMBER_LIMIT;
    process.env.ROOM_MEMBER_LIMIT = '2';
    try {
      const hostAuth = await signIn();
      const created = await call('create-room', hostAuth, { displayName: 'Cap Host' });
      expect(created.status).toBe(201);
      const room = (await created.json()) as { roomId: string; roomCode: string; hostToken: string };

      const guestAuth = await signIn();
      const joined = await call('join-room', guestAuth, {
        code: room.roomCode,
        displayName: 'Cap Guest One',
      });
      expect(joined.status).toBe(200);

      const extraAuth = await signIn();
      const full = await call('join-room', extraAuth, {
        code: room.roomCode,
        displayName: 'Cap Guest Two',
      });
      expect(full.status).toBe(409);
      expect(await full.json()).toMatchObject({ error: { code: 'ROOM_FULL' } });

      const rejoin = await call('join-room', guestAuth, {
        code: room.roomCode,
        displayName: 'Cap Guest One',
      });
      expect(rejoin.status).toBe(200);

      await call('host-command', hostAuth, { roomId: room.roomId, action: 'end' }, {
        'x-room-host-token': room.hostToken,
      });
    } finally {
      if (previous === undefined) {
        delete process.env.ROOM_MEMBER_LIMIT;
      } else {
        process.env.ROOM_MEMBER_LIMIT = previous;
      }
    }
  });

  it('sweeps an abandoned room when the next room is created', async () => {
    const { serviceDatabase } = await import('../../server/db/client');
    const sql = serviceDatabase();
    const hostAuth = await signIn();

    const first = await call('create-room', hostAuth, { displayName: 'Abandoned Host' });
    expect(first.status).toBe(201);
    const firstRoom = (await first.json()) as { roomId: string; hostToken: string };
    await sql`update public.rooms set created_at = now() - interval '40 minutes' where id = ${firstRoom.roomId}::uuid`;
    await sql`update public.members set last_seen_at = now() - interval '40 minutes' where room_id = ${firstRoom.roomId}::uuid`;

    const second = await call('create-room', hostAuth, { displayName: 'Fresh Host' });
    expect(second.status).toBe(201);
    const secondRoom = (await second.json()) as { roomId: string; hostToken: string };

    const remaining = await sql`select count(*)::int as count from public.rooms where id = ${firstRoom.roomId}::uuid`;
    expect(remaining[0]?.count).toBe(0);

    const stale = await call('host-room-read', hostAuth, { roomId: firstRoom.roomId }, {
      'x-room-host-token': firstRoom.hostToken,
    });
    expect(stale.status).toBe(401);

    const fresh = await call('host-room-read', hostAuth, { roomId: secondRoom.roomId }, {
      'x-room-host-token': secondRoom.hostToken,
    });
    expect(fresh.status).toBe(200);
  });
});
