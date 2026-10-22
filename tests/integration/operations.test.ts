import { createServer, type IncomingMessage, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const BASE = 'http://127.0.0.1:3000';
const runsHere = Boolean(
  process.env.AUTH_DATABASE_URL
  && process.env.DATABASE_URL
  && process.env.BETTER_AUTH_SECRET,
);

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

async function signIn(): Promise<string> {
  const response = await fetch(BASE + '/api/auth/sign-in/anonymous', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: '{}',
  });
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
    handler = (await import('../../api/[...path]')).default;
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
});
