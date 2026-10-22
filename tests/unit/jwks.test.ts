import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { fetchJwks } from '../../server/auth/jwks';

let server: Server | undefined;
let hits = 0;

afterEach(async () => {
  if (server !== undefined) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
  hits = 0;
});

async function serve(payload: () => unknown, status = 200): Promise<string> {
  server = createServer((_request, response) => {
    hits += 1;
    response.statusCode = status;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(payload()));
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the test server has no port');
  }
  return `http://127.0.0.1:${address.port}/jwks`;
}

describe('JWKS cache', () => {
  it('reuses a fresh key set for the same URL', async () => {
    const url = await serve(() => ({ keys: [{ kid: 'k1' }] }));

    await fetchJwks(url);
    await fetchJwks(url);

    expect(hits).toBe(1);
  });

  it('refreshes the key set when forced after a rotation', async () => {
    let kid = 'k1';
    const url = await serve(() => ({ keys: [{ kid }] }));

    expect((await fetchJwks(url))[0]?.kid).toBe('k1');
    kid = 'k2';
    expect((await fetchJwks(url))[0]?.kid).toBe('k1');
    expect((await fetchJwks(url, { force: true }))[0]?.kid).toBe('k2');
    expect(hits).toBe(2);
  });

  it('reports a key set that cannot be read', async () => {
    const url = await serve(() => ({ message: 'nope' }), 500);
    await expect(fetchJwks(url)).rejects.toThrow('the key set could not be read: 500');
  });

  it('rejects a response without a key array', async () => {
    const url = await serve(() => ({ keys: 'nope' }));
    await expect(fetchJwks(url)).rejects.toThrow('the key set could not be read');
  });
});
