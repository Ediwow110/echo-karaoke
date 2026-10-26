function readInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

export function resolveRoomMemberLimit(
  env: Record<string, string | undefined> = process.env,
): number {
  return readInt(env.ROOM_MEMBER_LIMIT, 50, 2, 500);
}

export function resolveSignInLimit(
  env: Record<string, string | undefined> = process.env,
): number {
  return readInt(env.ANON_SIGNIN_LIMIT_PER_HOUR, 120, 1, 1000);
}

/**
 * Requests per minute for one session, across every operation. The ceiling sits
 * just above the product's own worst case rather than at a comfortable average:
 * the songbook filters on a 200ms debounce, so sustained fast typing can reach
 * five requests a second, and a budget that throttled that would be a bug the
 * user experiences as a broken search box. A scripted client still meets the
 * ceiling inside a second.
 */
export function resolveApiRequestLimit(
  env: Record<string, string | undefined> = process.env,
): number {
  return readInt(env.API_REQUESTS_PER_MINUTE, 300, 30, 1200);
}
