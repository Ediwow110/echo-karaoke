import { operationCall, serviceDatabase } from '../db/client.js';

const SWEEP_BUCKET = 'room-sweep';
const DEFAULT_SWEEP_INTERVAL_SECONDS = 300;

export function sweepIntervalSeconds(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = (env.ROOM_SWEEP_INTERVAL_SECONDS ?? '').trim();
  if (raw.length === 0) {
    return DEFAULT_SWEEP_INTERVAL_SECONDS;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 86400
    ? Math.floor(value)
    : DEFAULT_SWEEP_INTERVAL_SECONDS;
}

export async function roomSweepDue(intervalSeconds = sweepIntervalSeconds()): Promise<boolean> {
  if (intervalSeconds <= 0) {
    return true;
  }
  const call = operationCall('consume_rate_limit', ['global', SWEEP_BUCKET, 1, intervalSeconds]);
  const rows = await serviceDatabase().query(call.text, call.params);
  const result = (rows[0] as { result?: { allowed?: boolean } } | undefined)?.result;
  return result?.allowed === true;
}

export async function sweepAbandonedRooms(): Promise<number> {
  const sql = serviceDatabase();
  const rows = await sql`select public.cleanup_abandoned_rooms(now() - interval '30 minutes') as deleted`;
  return Number(rows[0]?.deleted ?? 0);
}

export async function sweepEndedRooms(): Promise<number> {
  const sql = serviceDatabase();
  const rows = await sql`select public.cleanup_ended_rooms(now() - interval '2 days') as deleted`;
  return Number(rows[0]?.deleted ?? 0);
}
