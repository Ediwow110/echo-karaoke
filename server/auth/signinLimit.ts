import { createHmac } from 'node:crypto';
import { operationCall, serviceDatabase } from '../db/client.js';
import { resolveSignInLimit } from '../operations/limits.js';
import { jsonResponse, logFailure } from '../operations/errors.js';
import { resolveTrustedOrigins } from './origins.js';

const BUCKET = 'anon-sign-in';
const WINDOW_SECONDS = 3600;

type LimitResult = { allowed?: unknown; retryAfterSeconds?: unknown };

export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded !== null) {
    const first = forwarded.split(',')[0]?.trim();
    if (first !== undefined && first.length > 0) {
      return first.slice(0, 64);
    }
  }
  const real = request.headers.get('x-real-ip')?.trim();
  if (real !== undefined && real.length > 0) {
    return real.slice(0, 64);
  }
  return 'unknown';
}

export function signInSubject(ip: string, secret: string): string {
  return 'signin:' + createHmac('sha256', secret).update(ip).digest('hex');
}

export function isTrustedSignInOrigin(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) {
    return true;
  }
  return resolveTrustedOrigins(env).includes(origin);
}

export async function enforceSignInLimit(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): Promise<Response | null> {
  if (!isTrustedSignInOrigin(request, env)) {
    return jsonResponse({
      error: { code: 'FORBIDDEN', message: 'That origin is not allowed' },
    }, 403);
  }

  const subject = signInSubject(clientIp(request), env.BETTER_AUTH_SECRET ?? '');
  let result: LimitResult | null = null;
  try {
    const call = operationCall('consume_rate_limit', [
      subject,
      BUCKET,
      resolveSignInLimit(env),
      WINDOW_SECONDS,
    ]);
    const rows = await serviceDatabase().query(call.text, call.params);
    result = (rows[0] as { result?: LimitResult } | undefined)?.result ?? null;
  } catch (error) {
    logFailure('auth/sign-in-limit', error, 503, request);
    return jsonResponse({
      error: {
        code: 'UNAVAILABLE',
        message: 'The guest session service is unavailable. Try again shortly.',
      },
    }, 503);
  }

  if (result === null || typeof result.allowed !== 'boolean') {
    logFailure('auth/sign-in-limit', new Error('the limiter returned no decision'), 503, request);
    return jsonResponse({
      error: {
        code: 'UNAVAILABLE',
        message: 'The guest session service is unavailable. Try again shortly.',
      },
    }, 503);
  }
  if (result.allowed === true) {
    return null;
  }

  const response = jsonResponse({
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many guest sessions from this network. Try again later.',
    },
  }, 429);
  const retryAfter = Number(result.retryAfterSeconds);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    response.headers.set('retry-after', String(Math.ceil(retryAfter)));
  }
  return response;
}
