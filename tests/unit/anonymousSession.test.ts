import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

function clientWith(auth: Record<string, unknown>): SupabaseClient {
  return { auth } as unknown as SupabaseClient;
}

async function loadModule() {
  vi.resetModules();
  return import('../../src/lib/supabase');
}

describe('ensureAnonymousSession', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('keeps a valid stored session and validates it only once', async () => {
    const getUser = vi.fn(async () => ({ data: { user: { id: 'user-a' } }, error: null }));
    const signInAnonymously = vi.fn(async () => ({ data: { session: { access_token: 'new' } }, error: null }));
    const supabase = clientWith({
      getSession: vi.fn(async () => ({ data: { session: { access_token: 'stored' } }, error: null })),
      getUser,
      signInAnonymously,
    });
    const { ensureAnonymousSession } = await loadModule();

    expect(await ensureAnonymousSession(supabase)).toBe('stored');
    expect(await ensureAnonymousSession(supabase)).toBe('stored');
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it('replaces a session the auth server rejects', async () => {
    const signOut = vi.fn(async () => ({ error: null }));
    const signInAnonymously = vi.fn(async () => ({ data: { session: { access_token: 'fresh' } }, error: null }));
    const supabase = clientWith({
      getSession: vi.fn(async () => ({ data: { session: { access_token: 'stale' } }, error: null })),
      getUser: vi.fn(async () => ({ data: { user: null }, error: { status: 401, message: 'invalid' } })),
      signOut,
      signInAnonymously,
    });
    const { ensureAnonymousSession } = await loadModule();

    expect(await ensureAnonymousSession(supabase)).toBe('fresh');
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it('keeps the stored session when auth is unreachable', async () => {
    const signOut = vi.fn(async () => ({ error: null }));
    const supabase = clientWith({
      getSession: vi.fn(async () => ({ data: { session: { access_token: 'stored' } }, error: null })),
      getUser: vi.fn(async () => ({ data: { user: null }, error: { status: 0, message: 'network' } })),
      signOut,
      signInAnonymously: vi.fn(),
    });
    const { ensureAnonymousSession } = await loadModule();

    expect(await ensureAnonymousSession(supabase)).toBe('stored');
    expect(signOut).not.toHaveBeenCalled();
  });

  it('creates an anonymous session when none is stored', async () => {
    const signInAnonymously = vi.fn(async () => ({ data: { session: { access_token: 'new' } }, error: null }));
    const supabase = clientWith({
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      getUser: vi.fn(),
      signInAnonymously,
    });
    const { ensureAnonymousSession } = await loadModule();

    expect(await ensureAnonymousSession(supabase)).toBe('new');
    expect(signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it('starts one anonymous session for concurrent callers', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const signInAnonymously = vi.fn(async () => {
      await gate;
      return { data: { session: { access_token: 'new' } }, error: null };
    });
    const supabase = clientWith({
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      getUser: vi.fn(),
      signInAnonymously,
    });
    const { ensureAnonymousSession } = await loadModule();

    const first = ensureAnonymousSession(supabase);
    const second = ensureAnonymousSession(supabase);
    release();

    await expect(Promise.all([first, second])).resolves.toEqual(['new', 'new']);
    expect(signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it('reports a failed anonymous sign-in', async () => {
    const supabase = clientWith({
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      getUser: vi.fn(),
      signInAnonymously: vi.fn(async () => ({ data: { session: null }, error: { message: 'disabled' } })),
    });
    const { ensureAnonymousSession } = await loadModule();

    await expect(ensureAnonymousSession(supabase)).rejects.toThrow('Could not start a guest session');
  });
});
