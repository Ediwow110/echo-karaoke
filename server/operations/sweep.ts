import { serviceDatabase } from '../db/client.js';

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
