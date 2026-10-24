export type Jwks = { keys: { kid: string; kty: string; crv: string; x: string; y: string }[] };
export type JwksSource = string | (() => Promise<unknown>);

const TTL_MS = 10 * 60 * 1000;

let cached: { source: JwksSource; keys: Jwks['keys']; fetchedAt: number } | null = null;

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
}
