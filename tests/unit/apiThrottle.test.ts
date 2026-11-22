import { describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn<(text: string, params: unknown[]) => Promise<unknown[]>>() }));

vi.mock('../../server/db/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/db/client.js')>();
  return { ...actual, serviceDatabase: () => ({ query: db.query }) };
});

import { enforceApiRequestLimit } from '../../server/operations/apiThrottle';
import { HttpError } from '../../server/operations/errors';
import { resolveApiRequestLimit } from '../../server/operations/limits';

describe('the per-session api budget', () => {
  it('keeps headroom above the measured worst case instead of sitting on it', () => {
    // The songbook's 200ms debounce can reach 300 requests a minute and the
    // four-second room poll adds 15. The search tab sends two requests per
    // 380ms pause, about 316 a minute, plus the same poll.
    expect(resolveApiRequestLimit({})).toBeGreaterThanOrEqual(331);
  });

  it('allows a session under its ceiling, keyed by the session and a one-minute window', async () => {
    db.query.mockReset();
    db.query.mockResolvedValue([{ result: { allowed: true } }]);

    await expect(enforceApiRequestLimit('user-1')).resolves.toBeUndefined();

    const [text, params] = db.query.mock.calls[0];
    expect(String(text)).toContain('consume_rate_limit');
    expect(params).toEqual(['user-1', 'api-minute', 420, 60]);
  });

  it('refuses past the ceiling with a 429 the client can show', async () => {
    db.query.mockReset();
    db.query.mockResolvedValue([{ result: { allowed: false } }]);

    await expect(enforceApiRequestLimit('user-1')).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
      message: 'Slow down: too many requests from this session',
    });
  });

  it('treats an unreadable answer as a failure, not as a free pass', async () => {
    db.query.mockReset();
    db.query.mockResolvedValue([{ result: null }]);

    await expect(enforceApiRequestLimit('user-1')).rejects.toBeInstanceOf(HttpError);
  });
});
