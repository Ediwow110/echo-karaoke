import { auth } from '../server/auth/auth.js';
import { handleOperation } from '../server/operations/index.js';
import { restoreApiRequest } from '../server/operations/rewrite.js';

async function handleRequest(request: Request): Promise<Response> {
  const restored = restoreApiRequest(request);
  const url = new URL(restored.url);
  if (url.pathname === '/api/auth' || url.pathname.startsWith('/api/auth/')) {
    return auth.handler(restored);
  }
  return handleOperation(restored);
}

export default { fetch: handleRequest };
