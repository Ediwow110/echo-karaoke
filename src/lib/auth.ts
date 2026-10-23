const TOKEN_TTL_MS = 10 * 60_000;

let bearerToken: string | null = null;
let tokenFetchedAt = 0;
let pending: Promise<string> | null = null;
let blockedUntil = 0;
let blockedMessage: string | null = null;

function blockFor(response: Response, message: string): void {
  const retryAfter = Number(response.headers.get('retry-after'));
  const seconds = Number.isFinite(retryAfter) && retryAfter > 0
    ? Math.min(retryAfter, 3600)
    : response.status === 429 ? 60 : 10;
  blockedUntil = Date.now() + seconds * 1000;
  blockedMessage = message;
}

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
      const resolved = typeof message === 'string' && message.length > 0
        ? message
        : response.status === 429
          ? 'Too many guest sessions. Try again later.'
          : 'The guest session service is unavailable. Try again shortly.';
      blockFor(response, resolved);
      return resolved;
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
  blockedUntil = 0;
  blockedMessage = null;
  bearerToken = token;
  tokenFetchedAt = Date.now();
  return token;
}

export function ensureAnonymousSession(): Promise<string> {
  if (bearerToken !== null && Date.now() - tokenFetchedAt < TOKEN_TTL_MS) {
    return Promise.resolve(bearerToken);
  }
  if (Date.now() < blockedUntil && blockedMessage !== null) {
    return Promise.reject(new Error(blockedMessage));
  }
  if (pending !== null) {
    return pending;
  }
  pending = requestToken().finally(() => {
    pending = null;
  });
  return pending;
}
