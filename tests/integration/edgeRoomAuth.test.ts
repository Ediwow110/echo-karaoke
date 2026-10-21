import { describe, expect, it } from 'vitest';
import { createEdgeApi } from '../../src/lib/edgeApi';

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
describe.skipIf(!runsLocally)('typed edge client against the local stack', () => {
  it('creates a room and reads it back through the client wrapper', async () => {
    const session = await anonymousSession();
    const client = createEdgeApi({
      url: BASE_URL,
      anonKey: ANON_KEY,
      getAccessToken: async () => session,
    });

    const created = await client.invoke<{
      roomId: string;
      roomCode: string;
      guestToken: string;
      hostToken: string;
    }>('create-room', { displayName: 'Client Host' });

    expect(created.roomId).toHaveLength(36);

    const live = await client.invoke<{ status: string; roster: unknown[] }>(
      'guest-room-read',
      { roomId: created.roomId },
      { guestToken: created.guestToken },
    );
    expect(live.status).toBe('live');
    expect(live.roster).toHaveLength(1);

    await expect(
      client.invoke('guest-room-read', { roomId: created.roomId }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
  });
});
describe.skipIf(!runsLocally)('queue command authorization', () => {
  it('adds a song with server-resolved metadata and rejects bad input', async () => {
    const hostSession = await anonymousSession();
    const created = await callFunction('create-room', {
      session: hostSession,
      body: { displayName: 'Queue Host' },
    });
    const roomId = created.body.roomId as string;
    const hostGuestToken = created.body.guestToken as string;

    const added = await callFunction('queue-command', {
      session: hostSession,
      roomHeader: 'x-room-guest-token',
      roomToken: hostGuestToken,
      body: { roomId, action: 'add', videoId: 'dQw4w9WgXcQ' },
    });
    expect(added.status).toBe(201);
    expect(added.body.position).toBe(1);
    expect(typeof added.body.title).toBe('string');
    expect((added.body.title as string).length).toBeGreaterThan(0);

    const noToken = await callFunction('queue-command', {
      session: hostSession,
      body: { roomId, action: 'add', videoId: 'dQw4w9WgXcQ' },
    });
    expect(noToken.status).toBe(401);

    const badId = await callFunction('queue-command', {
      session: hostSession,
      roomHeader: 'x-room-guest-token',
      roomToken: hostGuestToken,
      body: { roomId, action: 'add', videoId: 'too-short' },
    });
    expect(badId.status).toBe(400);

    const unknownVideo = await callFunction('queue-command', {
      session: hostSession,
      roomHeader: 'x-room-guest-token',
      roomToken: hostGuestToken,
      body: { roomId, action: 'add', videoId: 'aaaaaaaaaaa' },
    });
    expect(unknownVideo.status).toBe(422);
    expect((unknownVideo.body.error as { code: string }).code).toBe('METADATA_UNAVAILABLE');
  });

  it('keeps song ownership and the guest lock enforced on the server', async () => {
    const hostSession = await anonymousSession();
    const guestSession = await anonymousSession();

    const created = await callFunction('create-room', {
      session: hostSession,
      body: { displayName: 'Owner Host' },
    });
    const roomId = created.body.roomId as string;
    const code = created.body.roomCode as string;
    const hostToken = created.body.hostToken as string;

    const joined = await callFunction('join-room', {
      session: guestSession,
      body: { code, displayName: 'Singer Two' },
    });
    const guestToken = joined.body.guestToken as string;

    const added = await callFunction('queue-command', {
      session: guestSession,
      roomHeader: 'x-room-guest-token',
      roomToken: guestToken,
      body: { roomId, action: 'add', videoId: 'dQw4w9WgXcQ' },
    });
    expect(added.status).toBe(201);
    const songId = added.body.songId as string;

    const hostOwnership = await callFunction('queue-command', {
      session: hostSession,
      roomHeader: 'x-room-guest-token',
      roomToken: created.body.guestToken as string,
      body: { roomId, action: 'remove', songId },
    });
    expect(hostOwnership.status).toBe(403);

    await callFunction('host-command', {
      session: hostSession,
      roomHeader: 'x-room-host-token',
      roomToken: hostToken,
      body: { roomId, action: 'lock' },
    });

    const lockedAdd = await callFunction('queue-command', {
      session: guestSession,
      roomHeader: 'x-room-guest-token',
      roomToken: guestToken,
      body: { roomId, action: 'add', videoId: 'dQw4w9WgXcQ' },
    });
    expect(lockedAdd.status).toBe(403);
    expect((lockedAdd.body.error as { code: string }).code).toBe('GUEST_CONTROLS_LOCKED');

    const hostAdd = await callFunction('queue-command', {
      session: hostSession,
      roomHeader: 'x-room-host-token',
      roomToken: hostToken,
      body: { roomId, action: 'add', videoId: 'dQw4w9WgXcQ' },
    });
    expect(hostAdd.status).toBe(201);

    const hostRemove = await callFunction('queue-command', {
      session: hostSession,
      roomHeader: 'x-room-host-token',
      roomToken: hostToken,
      body: { roomId, action: 'remove', songId },
    });
    expect(hostRemove.status).toBe(200);
    expect(hostRemove.body.removed).toBe(true);
  });
});
describe.skipIf(!runsLocally)('youtube search authorization', () => {
  it('requires a session and a room pass before searching', async () => {
    const noSession = await callFunction('youtube-search', {
      body: { roomId: '3a1ee27f-a539-4190-9250-bdc14ff631e0', query: 'abba' },
    });
    expect(noSession.status).toBe(401);

    const session = await anonymousSession();
    const created = await callFunction('create-room', {
      session,
      body: { displayName: 'Search Host' },
    });
    const roomId = created.body.roomId as string;

    const noToken = await callFunction('youtube-search', {
      session,
      body: { roomId, query: 'abba' },
    });
    expect(noToken.status).toBe(401);

    const badToken = await callFunction('youtube-search', {
      session,
      roomHeader: 'x-room-guest-token',
      roomToken: 'x'.repeat(43),
      body: { roomId, query: 'abba' },
    });
    expect(badToken.status).toBe(401);
  });

  it('reports search as unavailable without a YouTube key and rejects empty queries', async () => {
    const session = await anonymousSession();
    const created = await callFunction('create-room', {
      session,
      body: { displayName: 'Search Host Two' },
    });
    const roomId = created.body.roomId as string;
    const guestToken = created.body.guestToken as string;

    const empty = await callFunction('youtube-search', {
      session,
      roomHeader: 'x-room-guest-token',
      roomToken: guestToken,
      body: { roomId, query: '   ' },
    });
    expect(empty.status).toBe(400);

    const withoutKey = await callFunction('youtube-search', {
      session,
      roomHeader: 'x-room-guest-token',
      roomToken: guestToken,
      body: { roomId, query: 'abba' },
    });
    expect(withoutKey.status).toBe(200);
    expect(withoutKey.body.available).toBe(false);
    expect(withoutKey.body.results).toEqual([]);
  });
});
describe.skipIf(!runsLocally)('playback authorization', () => {
  it('plays, pauses and skips through the room pass and blocks locked guests', async () => {
    const hostSession = await anonymousSession();
    const guestSession = await anonymousSession();

    const created = await callFunction('create-room', {
      session: hostSession,
      body: { displayName: 'Player Host' },
    });
    const roomId = created.body.roomId as string;
    const code = created.body.roomCode as string;
    const hostToken = created.body.hostToken as string;

    await callFunction('queue-command', {
      session: hostSession,
      roomHeader: 'x-room-guest-token',
      roomToken: created.body.guestToken as string,
      body: { roomId, action: 'add', videoId: 'dQw4w9WgXcQ' },
    });

    const joined = await callFunction('join-room', {
      session: guestSession,
      body: { code, displayName: 'Player Guest' },
    });
    const guestToken = joined.body.guestToken as string;

    const noToken = await callFunction('playback-command', {
      session: guestSession,
      body: { roomId, action: 'play' },
    });
    expect(noToken.status).toBe(401);

    const played = await callFunction('playback-command', {
      session: guestSession,
      roomHeader: 'x-room-guest-token',
      roomToken: guestToken,
      body: { roomId, action: 'play' },
    });
    expect(played.status).toBe(200);
    const playback = played.body.playback as { isPlaying: boolean; currentVideoId: string };
    expect(playback.isPlaying).toBe(true);
    expect(playback.currentVideoId).toBe('dQw4w9WgXcQ');

    await callFunction('host-command', {
      session: hostSession,
      roomHeader: 'x-room-host-token',
      roomToken: hostToken,
      body: { roomId, action: 'lock' },
    });

    const locked = await callFunction('playback-command', {
      session: guestSession,
      roomHeader: 'x-room-guest-token',
      roomToken: guestToken,
      body: { roomId, action: 'pause' },
    });
    expect(locked.status).toBe(403);
    expect((locked.body.error as { code: string }).code).toBe('GUEST_CONTROLS_LOCKED');

    const hostPause = await callFunction('playback-command', {
      session: hostSession,
      roomHeader: 'x-room-host-token',
      roomToken: hostToken,
      body: { roomId, action: 'pause' },
    });
    expect(hostPause.status).toBe(200);
    expect((hostPause.body.playback as { isPlaying: boolean }).isPlaying).toBe(false);

    const reported = await callFunction('playback-report', {
      session: hostSession,
      roomHeader: 'x-room-host-token',
      roomToken: hostToken,
      body: { roomId, positionSeconds: 33 },
    });
    expect(reported.status).toBe(200);
    expect(reported.body.positionSeconds).toBe(33);

    const guestReport = await callFunction('playback-report', {
      session: guestSession,
      roomHeader: 'x-room-host-token',
      roomToken: guestToken,
      body: { roomId, positionSeconds: 33 },
    });
    expect(guestReport.status).toBe(401);

    const skipped = await callFunction('playback-command', {
      session: hostSession,
      roomHeader: 'x-room-host-token',
      roomToken: hostToken,
      body: { roomId, action: 'next' },
    });
    expect(skipped.status).toBe(200);
    expect((skipped.body.playback as { currentVideoId: string | null }).currentVideoId).toBeNull();
  });
});
describe.skipIf(!runsLocally)('votes and heartbeat', () => {
  it('toggles a vote and refreshes the roster heartbeat', async () => {
    const hostSession = await anonymousSession();
    const guestSession = await anonymousSession();

    const created = await callFunction('create-room', {
      session: hostSession,
      body: { displayName: 'Vote Host' },
    });
    const roomId = created.body.roomId as string;
    const code = created.body.roomCode as string;
    const hostToken = created.body.hostToken as string;

    const added = await callFunction('queue-command', {
      session: hostSession,
      roomHeader: 'x-room-guest-token',
      roomToken: created.body.guestToken as string,
      body: { roomId, action: 'add', videoId: 'dQw4w9WgXcQ' },
    });
    const songId = added.body.songId as string;

    const joined = await callFunction('join-room', {
      session: guestSession,
      body: { code, displayName: 'Voter' },
    });
    const guestToken = joined.body.guestToken as string;

    const noToken = await callFunction('vote-command', {
      session: guestSession,
      body: { roomId, songId },
    });
    expect(noToken.status).toBe(401);

    const voted = await callFunction('vote-command', {
      session: guestSession,
      roomHeader: 'x-room-guest-token',
      roomToken: guestToken,
      body: { roomId, songId },
    });
    expect(voted.status).toBe(200);
    expect(voted.body.voteCount).toBe(1);
    expect(voted.body.votedByViewer).toBe(true);

    const unvoted = await callFunction('vote-command', {
      session: guestSession,
      roomHeader: 'x-room-guest-token',
      roomToken: guestToken,
      body: { roomId, songId },
    });
    expect(unvoted.body.voteCount).toBe(0);
    expect(unvoted.body.votedByViewer).toBe(false);

    const heartbeat = await callFunction('touch-member', {
      session: guestSession,
      roomHeader: 'x-room-guest-token',
      roomToken: guestToken,
      body: { roomId },
    });
    expect(heartbeat.status).toBe(200);
    expect(typeof heartbeat.body.memberId).toBe('string');

    const badHeartbeat = await callFunction('touch-member', {
      session: guestSession,
      roomHeader: 'x-room-guest-token',
      roomToken: 'x'.repeat(43),
      body: { roomId },
    });
    expect(badHeartbeat.status).toBe(401);

    await callFunction('host-command', {
      session: hostSession,
      roomHeader: 'x-room-host-token',
      roomToken: hostToken,
      body: { roomId, action: 'lock' },
    });

    const lockedVote = await callFunction('vote-command', {
      session: guestSession,
      roomHeader: 'x-room-guest-token',
      roomToken: guestToken,
      body: { roomId, songId },
    });
    expect(lockedVote.status).toBe(403);
    expect((lockedVote.body.error as { code: string }).code).toBe('GUEST_CONTROLS_LOCKED');
  });
});
describe.skipIf(!runsLocally)('youtube suggestions', () => {
  it('requires a session and a room pass, and rejects very short terms', async () => {
    const session = await anonymousSession();
    const created = await callFunction('create-room', {
      session,
      body: { displayName: 'Typing Host' },
    });
    const roomId = created.body.roomId as string;
    const guestToken = created.body.guestToken as string;

    const noToken = await callFunction('youtube-suggest', {
      session,
      body: { roomId, query: 'dancing queen' },
    });
    expect(noToken.status).toBe(401);

    const tooShort = await callFunction('youtube-suggest', {
      session,
      roomHeader: 'x-room-guest-token',
      roomToken: guestToken,
      body: { roomId, query: 'a' },
    });
    expect(tooShort.status).toBe(400);

    const suggestions = await callFunction('youtube-suggest', {
      session,
      roomHeader: 'x-room-guest-token',
      roomToken: guestToken,
      body: { roomId, query: 'dancing queen' },
    });
    expect(suggestions.status).toBe(200);
    const list = suggestions.body.suggestions as string[];
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
    expect(list.length).toBeLessThanOrEqual(10);
    for (const item of list) {
      expect(typeof item).toBe('string');
      expect(item.length).toBeGreaterThan(0);
    }
  });
});

describe.skipIf(!runsLocally)('youtube popular songs', () => {
  it('needs a room pass and reports popular songs as unavailable without a YouTube key', async () => {
    const session = await anonymousSession();
    const created = await callFunction('create-room', {
      session,
      body: { displayName: 'Popular Host' },
    });
    const roomId = created.body.roomId as string;
    const guestToken = created.body.guestToken as string;

    const noSession = await callFunction('youtube-popular', {
      body: { roomId },
    });
    expect(noSession.status).toBe(401);

    const noToken = await callFunction('youtube-popular', {
      session,
      body: { roomId },
    });
    expect(noToken.status).toBe(401);

    const badToken = await callFunction('youtube-popular', {
      session,
      roomHeader: 'x-room-guest-token',
      roomToken: 'x'.repeat(43),
      body: { roomId },
    });
    expect(badToken.status).toBe(401);

    const withoutKey = await callFunction('youtube-popular', {
      session,
      roomHeader: 'x-room-guest-token',
      roomToken: guestToken,
      body: { roomId },
    });
    expect(withoutKey.status).toBe(200);
    expect(withoutKey.body.available).toBe(false);
    expect(withoutKey.body.results).toEqual([]);
  });
});
