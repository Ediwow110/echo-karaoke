import { timingSafeEqual } from 'node:crypto';
import { operationCall, serviceDatabase } from '../db/client.js';

function bearerMatches(header: string | null, secret: string): boolean {
  const expected = Buffer.from('Bearer ' + secret);
  const supplied = Buffer.from(header ?? '');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

// Vercel Cron is a GET request, not a room user. Never pass it through the
// anonymous Better Auth flow or expose this operation in the public registry.
export async function catalogRetentionCron(request: Request): Promise<Response> {
  if (process.env.VERCEL_ENV !== 'production') {
    return new Response(null, { status: 404 });
  }
  if (request.method !== 'GET') {
    return new Response(null, { status: 405 });
  }
  const secret = process.env.CRON_SECRET ?? '';
  if (secret.length < 32) {
    return new Response(null, { status: 503 });
  }
  if (!bearerMatches(request.headers.get('authorization'), secret)) {
    return new Response(null, { status: 401 });
  }

  try {
    const call = operationCall('karaoke_catalog_retire_stale', []);
    const rows = await serviceDatabase().query(call.text, call.params);
    const result = (rows[0] as { result?: unknown } | undefined)?.result;
    if (result === null || typeof result !== 'object') {
      throw new Error('Retention operation did not return a result');
    }
    const retired = result as { retiredSongs?: unknown; retiredCursors?: unknown };
    if (!Number.isSafeInteger(retired.retiredSongs) || !Number.isSafeInteger(retired.retiredCursors)) {
      throw new Error('Retention operation returned invalid counts');
    }
    return Response.json({
      ok: true,
      retiredSongs: retired.retiredSongs,
      retiredCursors: retired.retiredCursors,
    }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    // Do not expose database contents, credentials or connection diagnostics.
    return Response.json({ ok: false }, {
      status: 500,
      headers: { 'cache-control': 'no-store' },
    });
  }
}
