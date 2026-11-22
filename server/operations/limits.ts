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
 * Failed room-code guesses one network may spend per Pacific day. Successful
 * joins do not charge this bucket; only a ROOM_NOT_FOUND answer does.
 */
export function resolveJoinFailureLimit(
  env: Record<string, string | undefined> = process.env,
): number {
  return readInt(env.JOIN_FAIL_LIMIT_PER_DAY, 60, 1, 1000);
}

/**
 * Requests per minute for one session, across every operation. The ceiling sits
 * above the product's measured worst case rather than on top of it: the
 * songbook filters on a 200ms debounce (five requests a second, 300 a minute),
 * the search tab sends a YouTube and a catalog request after each 380ms pause
 * (about 316 a minute), and the four-second room poll adds 15. At 300 those
 * combinations throttle ordinary use, so the default is 420: seven requests a
 * second, above that worst case, while a scripted client still meets the
 * ceiling inside a second.
 */
export function resolveApiRequestLimit(
  env: Record<string, string | undefined> = process.env,
): number {
  return readInt(env.API_REQUESTS_PER_MINUTE, 420, 30, 1200);
}
