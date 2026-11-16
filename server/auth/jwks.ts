export type Jwks = { keys: { kid: string; kty: string; crv: string; x: string; y: string }[] };
export type JwksSource = string | (() => Promise<unknown>);

const TTL_MS = 10 * 60 * 1000;

let cached: { source: JwksSource; keys: Jwks['keys']; fetchedAt: number } | null = null;
let pending: { source: JwksSource; promise: Promise<Jwks['keys']> } | null = null;

export async function fetchJwks(
  source: JwksSource,
  options: { force?: boolean } = {},
): Promise<Jwks['keys']> {
  if (
    options.force !== true
    && cached !== null
    && cached.source === source
    && Date.now() - cached.fetchedAt < TTL_MS
  ) {
    return cached.keys;
  }
  // A cold cache must not become one loader call per concurrent request.
  if (pending !== null && pending.source === source) {
    return pending.promise;
  }

  const promise = (async () => {
    let body: Jwks;
    if (typeof source === 'string') {
      const response = await fetch(source, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) {
        throw new Error(`the key set could not be read: ${response.status}`);
      }
      body = (await response.json()) as Jwks;
    } else {
      body = (await source()) as Jwks;
    }
    if (!Array.isArray(body?.keys)) {
      throw new Error('the key set could not be read');
    }

    cached = { source, keys: body.keys, fetchedAt: Date.now() };
    return body.keys;
  })();
  pending = { source, promise };
  try {
    return await promise;
  } finally {
    if (pending?.promise === promise) {
      pending = null;
    }
  }
}
