export type Jwks = { keys: { kid: string; kty: string; crv: string; x: string; y: string }[] };

const TTL_MS = 10 * 60 * 1000;

let cached: { url: string; keys: Jwks['keys']; fetchedAt: number } | null = null;

export async function fetchJwks(url: string): Promise<Jwks['keys']> {
  if (cached !== null && cached.url === url && Date.now() - cached.fetchedAt < TTL_MS) {
    return cached.keys;
  }

  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) {
    throw new Error(`the key set could not be read: ${response.status}`);
  }

  const body = (await response.json()) as Jwks;
  if (!Array.isArray(body.keys)) {
    throw new Error('the key set could not be read');
  }

  cached = { url, keys: body.keys, fetchedAt: Date.now() };
  return body.keys;
}
