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
    return auth.handler(restored);
  }
  return handleOperation(restored);
}

export default { fetch: handleRequest };
