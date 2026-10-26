import { HttpError } from './errors.js';
import { resolveApiRequestLimit } from './limits.js';
import { callOperation } from './room.js';

/**
 * Every operation is reachable from a browser console holding the page's own
 * session, so "the UI is the only client" is not a protection. This puts a
 * budget on the session itself, in the shared dispatch path so a new operation
 * cannot be added without it.
 *
 * The ceiling is deliberately generous: one device polls a room every four
 * seconds and touches it a few times a minute, roughly twenty-five requests a
 * minute in total. A scripted client is the only thing that will notice.
 */
export async function enforceApiRequestLimit(userId: string): Promise<void> {
  const result = (await callOperation('consume_rate_limit', [
    userId,
    'api-minute',
    resolveApiRequestLimit(),
    60,
  ])) as { allowed?: boolean } | null;

  if (result?.allowed !== true) {
    throw new HttpError('RATE_LIMITED', 429, 'Slow down: too many requests from this session');
  }
}
