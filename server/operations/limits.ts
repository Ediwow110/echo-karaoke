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
