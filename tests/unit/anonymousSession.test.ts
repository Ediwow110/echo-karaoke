import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Call = { url: string; init: RequestInit };

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return handler(call.url, call.init);
  }));
  return calls;
}

async function loadAuth() {
  vi.resetModules();
  return import('../../src/lib/auth');
}

describe('the anonymous session', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reuses the token from an existing session without signing in', async () => {
    let tokenCalls = 0;
    const calls = stubFetch((url) => {
      if (url.endsWith('/api/auth/token')) {
        tokenCalls += 1;
        return jsonResponse({ token: 'bearer-token' });
      }
      return jsonResponse({}, 404);
    });
    const { ensureAnonymousSession } = await loadAuth();

    expect(await ensureAnonymousSession()).toBe('bearer-token');
    expect(await ensureAnonymousSession()).toBe('bearer-token');
    expect(tokenCalls).toBe(1);
    expect(calls.some((call) => call.url.endsWith('/api/auth/sign-in/anonymous'))).toBe(false);
    expect(calls[0].init.credentials).toBe('include');
  });

  it('signs in anonymously when no session token exists', async () => {
    let tokenCalls = 0;
    let signInCalls = 0;
    const calls = stubFetch((url, init) => {
      if (url.endsWith('/api/auth/token')) {
        tokenCalls += 1;
        return tokenCalls === 1 ? jsonResponse({}, 401) : jsonResponse({ token: 'bearer-token' });
      }
      if (url.endsWith('/api/auth/sign-in/anonymous')) {
        signInCalls += 1;
        expect(init.method).toBe('POST');
        expect(init.credentials).toBe('include');
        return jsonResponse({ user: { id: 'user-1' } });
      }
      return jsonResponse({}, 404);
    });
    const { ensureAnonymousSession } = await loadAuth();

    expect(await ensureAnonymousSession()).toBe('bearer-token');
    expect(await ensureAnonymousSession()).toBe('bearer-token');
    expect(signInCalls).toBe(1);
    expect(tokenCalls).toBe(2);
    expect(calls.length).toBe(3);
  });

  it('refreshes the token after its in-memory lifetime', async () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    let tokenCalls = 0;
    stubFetch((url) => {
      if (url.endsWith('/api/auth/token')) {
        tokenCalls += 1;
        return jsonResponse({ token: tokenCalls === 1 ? 'first-token' : 'second-token' });
      }
      return jsonResponse({}, 404);
    });
    const { ensureAnonymousSession } = await loadAuth();

    expect(await ensureAnonymousSession()).toBe('first-token');
    now += 10 * 60_000 + 1;
    expect(await ensureAnonymousSession()).toBe('second-token');
    expect(tokenCalls).toBe(2);
  });

  it('starts one token request for concurrent callers', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let tokenCalls = 0;
    stubFetch(async (url) => {
      if (url.endsWith('/api/auth/token')) {
        tokenCalls += 1;
        await gate;
        return jsonResponse({ token: 'shared-token' });
      }
      return jsonResponse({}, 404);
    });
    const { ensureAnonymousSession } = await loadAuth();

    const first = ensureAnonymousSession();
    const second = ensureAnonymousSession();
    release();
    await expect(Promise.all([first, second])).resolves.toEqual(['shared-token', 'shared-token']);
    expect(tokenCalls).toBe(1);
  });

  it('reports the server reason when sign-in is rate limited', async () => {
    stubFetch((url) => {
      if (url.endsWith('/api/auth/token')) return jsonResponse({}, 401);
      if (url.endsWith('/api/auth/sign-in/anonymous')) {
        return jsonResponse({
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many guest sessions from this network. Try again later.',
          },
        }, 429);
      }
      return jsonResponse({}, 404);
    });
    const { ensureAnonymousSession } = await loadAuth();

    await expect(ensureAnonymousSession()).rejects.toThrow(
      'Too many guest sessions from this network. Try again later.',
    );
  });

  it('backs off after a rate-limit response instead of retrying on every poll', async () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    let limited = true;
    let tokenCalls = 0;
    let signInCalls = 0;
    stubFetch((url) => {
      if (url.endsWith('/api/auth/token')) {
        tokenCalls += 1;
        return limited ? jsonResponse({}, 401) : jsonResponse({ token: 'fresh-token' });
      }
      if (url.endsWith('/api/auth/sign-in/anonymous')) {
        signInCalls += 1;
        return limited
          ? jsonResponse({
            error: {
              code: 'RATE_LIMITED',
              message: 'Too many guest sessions from this network. Try again later.',
            },
          }, 429, { 'Retry-After': '60' })
          : jsonResponse({});
      }
      return jsonResponse({}, 404);
    });
    const { ensureAnonymousSession } = await loadAuth();

    await expect(ensureAnonymousSession()).rejects.toThrow('Too many guest sessions');
    await expect(ensureAnonymousSession()).rejects.toThrow('Too many guest sessions');
    expect(tokenCalls).toBe(2);
    expect(signInCalls).toBe(1);

    limited = false;
    now += 61_000;
    expect(await ensureAnonymousSession()).toBe('fresh-token');
    expect(tokenCalls).toBe(3);
    expect(signInCalls).toBe(1);
  });

  it('reports a failed sign-in and token exchange', async () => {
    stubFetch((url) => {
      if (url.endsWith('/api/auth/token')) return jsonResponse({}, 401);
      if (url.endsWith('/api/auth/sign-in/anonymous')) return jsonResponse({}, 500);
      return jsonResponse({}, 404);
    });
    const { ensureAnonymousSession } = await loadAuth();

    await expect(ensureAnonymousSession()).rejects.toThrow('Could not start a guest session');
  });
});
