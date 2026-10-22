import { auth } from '../server/auth/auth';
import { handleOperation } from '../server/operations';

export const config = { runtime: 'nodejs24' };

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/api/auth' || url.pathname.startsWith('/api/auth/')) {
    return auth.handler(request);
  }
  return handleOperation(request);
}
