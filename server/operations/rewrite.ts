import { resolveBaseUrl } from '../auth/origins.js';

const INVALID_PATH = '/api/__invalid__';

/**
 * Vercel file routing gives a function file one path. The /api/* rewrite sends
 * every API path to the router with the original path in `path`, and the router
 * rebuilds the URL that Better Auth and the operations expect. Vercel dev also
 * hands the function a relative URL, so it is resolved against the auth origin.
 */
export function restoreApiRequest(
  request: Request,
  baseUrl: string = resolveBaseUrl(),
): Request {
  const url = new URL(request.url, baseUrl);
  const raw = url.searchParams.get('path');
  if (raw !== null) {
    url.searchParams.delete('path');
    const segments = raw.split('/').filter((segment) => segment.length > 0);
    const invalid = segments.some(
      (segment) => segment === '.' || segment === '..' || segment.includes('\\') || segment.includes('\0'),
    );
    url.pathname = invalid || segments.length === 0
      ? INVALID_PATH
      : '/api/' + segments.join('/');
  }

  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers: request.headers,
    redirect: request.redirect,
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
    init.duplex = 'half';
  }
  return new Request(url, init);
}
