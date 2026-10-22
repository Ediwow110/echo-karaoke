import { describe, expect, it } from 'vitest';
import { restoreApiRequest } from '../../server/operations/rewrite';

describe('API rewrite', () => {
  it('restores the original path, query, method, and body', async () => {
    const request = new Request('https://app.example/api/router?path=auth/token&next=1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"a":1}',
    });

    const restored = restoreApiRequest(request);
    const url = new URL(restored.url);

    expect(url.pathname).toBe('/api/auth/token');
    expect(url.searchParams.get('path')).toBeNull();
    expect(url.searchParams.get('next')).toBe('1');
    expect(restored.method).toBe('POST');
    expect(await restored.text()).toBe('{"a":1}');
  });

  it('keeps a direct request on its path', () => {
    const request = new Request('https://app.example/api/create-room');
    const restored = restoreApiRequest(request);
    expect(new URL(restored.url).pathname).toBe('/api/create-room');
    expect(restored.method).toBe('GET');
  });

  it('resolves the relative URL that Vercel dev passes to a function', () => {
    const request = {
      url: '/api/router?path=auth/jwks',
      method: 'GET',
      headers: new Headers(),
      redirect: 'manual',
      body: null,
    } as unknown as Request;

    const restored = restoreApiRequest(request, 'http://127.0.0.1:3101');
    expect(restored.url).toBe('http://127.0.0.1:3101/api/auth/jwks');
  });

  it('refuses traversal and empty paths', () => {
    for (const raw of ['..%2Fadmin', 'auth/../admin', '\\admin', '']) {
      const request = new Request('https://app.example/api/router?path=' + raw);
      expect(new URL(restoreApiRequest(request).url).pathname).toBe('/api/__invalid__');
    }
  });
});
