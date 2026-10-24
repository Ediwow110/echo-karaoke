import { auth } from '../server/auth/auth.js';
import { enforceSignInLimit } from '../server/auth/signinLimit.js';
import { handleOperation } from '../server/operations/index.js';
import { restoreApiRequest } from '../server/operations/rewrite.js';

async function handleRequest(request: Request): Promise<Response> {
  const restored = restoreApiRequest(request);
  const url = new URL(restored.url);
  if (url.pathname === '/api/auth' || url.pathname.startsWith('/api/auth/')) {
    if (url.pathname === '/api/auth/sign-in/anonymous' && restored.method === 'POST') {
      const limited = await enforceSignInLimit(restored);
      if (limited !== null) {
        return limited;
      }
    }
    const response = await auth.handler(restored);
    if (url.pathname === '/api/auth/jwks' && response.ok) {
      const headers = new Headers(response.headers);
      headers.set('cache-control', 'public, max-age=0, s-maxage=300');
      headers.set('vercel-cdn-cache-control', 'public, s-maxage=300, stale-while-revalidate=60');
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }
    return response;
  }
  return handleOperation(restored);
}

export default { fetch: handleRequest };
