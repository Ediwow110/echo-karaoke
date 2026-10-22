const TOKEN_TTL_MS = 10 * 60_000;

let bearerToken: string | null = null;
let tokenFetchedAt = 0;
let pending: Promise<string> | null = null;

async function fetchToken(): Promise<string | null> {
  try {
    const response = await fetch('/api/auth/token', {
      credentials: 'include',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { token?: unknown };
    return typeof body.token === 'string' && body.token.length > 0 ? body.token : null;
  } catch {
    return null;
  }
}

async function signIn(): Promise<string | null> {
  try {
    const response = await fetch('/api/auth/sign-in/anonymous', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      credentials: 'include',
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 429 || response.status === 503) {
      const body = (await response.json().catch(() => null)) as
        { error?: { message?: unknown } } | null;
      const message = body?.error?.message;
      return typeof message === 'string' && message.length > 0 ? message : null;
    }
  } catch {
    // The second token request reports whether a usable session exists.
  }
  return null;
}

async function requestToken(): Promise<string> {
  let token = await fetchToken();
  let signInError: string | null = null;
  if (token === null) {
    signInError = await signIn();
    token = await fetchToken();
  }
  if (token === null) {
    throw new Error(
      signInError ?? 'Could not start a guest session. Try reloading the page.',
    );
  }
  bearerToken = token;
  tokenFetchedAt = Date.now();
  return token;
}

export function ensureAnonymousSession(): Promise<string> {
  if (bearerToken !== null && Date.now() - tokenFetchedAt < TOKEN_TTL_MS) {
    return Promise.resolve(bearerToken);
  }
  if (pending !== null) {
    return pending;
  }
  pending = requestToken().finally(() => {
    pending = null;
  });
  return pending;
}
