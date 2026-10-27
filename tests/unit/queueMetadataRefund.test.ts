import { beforeEach, describe, expect, it, vi } from 'vitest';

const { callOperation, fetchVideoMetadata } = vi.hoisted(() => ({
  callOperation: vi.fn(),
  fetchVideoMetadata: vi.fn(),
}));

vi.mock('../../server/operations/room.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/operations/room.js')>();
  return { ...actual, callOperation };
});

vi.mock('../../server/operations/metadata.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/operations/metadata.js')>();
  return { ...actual, fetchVideoMetadata };
});

import { queueCommand } from '../../server/operations/queue';

const ROOM_ID = '11111111-1111-4111-8111-111111111111';
const VIDEO_ID = 'dQw4w9WgXcQ';
const caller = { userId: 'user-1', accessToken: 'access-token' };

function defaultOperation(name: string): Promise<unknown> {
  if (name === 'queue_add_preflight') return Promise.resolve({ allowed: true });
  if (name === 'consume_rate_limit') return Promise.resolve({ allowed: true });
  if (name === 'consume_daily_rate_limit') return Promise.resolve({ allowed: true });
  if (name === 'refund_daily_rate_limit') return Promise.resolve({ count: 0 });
  if (name === 'queue_add') return Promise.resolve({ songId: 'song-1' });
  return Promise.resolve({});
}

function addRequest(): Request {
  return new Request('http://localhost/api/queue-command', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-room-guest-token': 'g'.repeat(40),
    },
    body: JSON.stringify({ roomId: ROOM_ID, action: 'add', videoId: VIDEO_ID }),
  });
}

function refundCalls(): unknown[][] {
  return (callOperation.mock.calls as [string, unknown[]][])
    .filter(([name]) => name === 'refund_daily_rate_limit')
    .map(([, params]) => params);
}

beforeEach(() => {
  callOperation.mockReset();
  fetchVideoMetadata.mockReset();
  callOperation.mockImplementation((name: string) => defaultOperation(name));
});

describe('song lookup budgets when the video cannot be read', () => {
  it('gives both shared daily budgets back when the lookup fails', async () => {
    fetchVideoMetadata.mockResolvedValue(null);

    await expect(queueCommand(addRequest(), caller)).rejects.toMatchObject({
      code: 'METADATA_UNAVAILABLE',
    });

    expect(refundCalls()).toEqual([
      ['room:' + ROOM_ID, 'queue-metadata-day'],
      ['global', 'queue-metadata-day'],
    ]);
    expect((callOperation.mock.calls as [string, unknown[]][])
      .some(([name]) => name === 'queue_add')).toBe(false);
  });

  it('gives the room charge back when the global pool is already empty', async () => {
    callOperation.mockImplementation((name: string, params: unknown[]) => {
      if (name === 'consume_daily_rate_limit' && params[0] === 'global') {
        return Promise.resolve({ allowed: false });
      }
      return defaultOperation(name);
    });

    await expect(queueCommand(addRequest(), caller)).rejects.toMatchObject({
      code: 'LOOKUP_RATE_LIMITED',
    });

    expect(refundCalls()).toEqual([
      ['room:' + ROOM_ID, 'queue-metadata-day'],
      ['global', 'queue-metadata-day'],
    ]);
    expect((callOperation.mock.calls as [string, unknown[]][])
      .some(([name]) => name === 'queue_add')).toBe(false);
  });

  it('keeps the charges when the song is actually added', async () => {
    fetchVideoMetadata.mockResolvedValue({
      videoId: VIDEO_ID,
      title: 'Afterglow',
      channelTitle: null,
      thumbnailUrl: null,
      durationSeconds: null,
    });

    const response = await queueCommand(addRequest(), caller);

    expect(response.status).toBe(201);
    expect(refundCalls()).toEqual([]);
    expect((callOperation.mock.calls as [string, unknown[]][])
      .some(([name]) => name === 'queue_add')).toBe(true);
  });
});
