import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

const runsHere = Boolean(
  process.env.DATABASE_URL
  && process.env.AUTH_DATABASE_URL
  && process.env.BETTER_AUTH_SECRET,
);

function token(prefix: string): string {
  return prefix.repeat(32) + randomUUID();
}

function roomCode(): string {
  return (randomUUID().replace(/-/g, '') + '0000000000000000').slice(0, 16).toUpperCase();
}

async function waitForLock(
  observer: Client,
  pid: number,
  timeoutMs = 5000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await observer.query(
      'select wait_event_type from pg_stat_activity where pid = $1',
      [pid],
    );
    if (result.rows[0]?.wait_event_type === 'Lock') {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

describe.skipIf(!runsHere)('host claim race', () => {
  it('refuses a claim that raced an uncommitted transfer', async () => {
    const clientA = new Client({ connectionString: process.env.DATABASE_URL });
    const clientB = new Client({ connectionString: process.env.DATABASE_URL });
    await Promise.all([clientA.connect(), clientB.connect()]);

    const suffix = randomUUID().replace(/-/g, '');
    const code = roomCode();
    const hostUser = 'race-host-' + suffix;
    const targetUser = 'race-target-' + suffix;
    const hostGuestToken = token('g');
    const hostToken = token('h');
    const targetGuestToken = token('t');
    const newGuestToken = token('n');
    const attackerHostToken = token('a');
    let roomId: string | undefined;

    try {
      const created = await clientA.query(
        'select public.create_room($1, $2, $3, $4, $5) as result',
        [code, hostUser, 'Race Host', hostGuestToken, hostToken],
      );
      roomId = created.rows[0].result.roomId as string;

      const joined = await clientA.query(
        'select public.join_room($1, $2, $3, $4, $5) as result',
        [code, targetUser, 'Race Target', targetGuestToken, 50],
      );
      const targetMemberId = joined.rows[0].result.memberId as string;

      // Hold the transfer open. It has demoted the caller, promoted the target,
      // and revoked the old secret, but it has not committed.
      await clientA.query('begin');
      await clientA.query(
        'select public.room_transfer_host($1, $2, $3, $4, $5) as result',
        [roomId, hostUser, hostToken, targetMemberId, newGuestToken],
      );

      const pidB = (await clientB.query('select pg_backend_pid() as pid')).rows[0].pid as number;
      const claim = clientB.query(
        'select public.room_claim_host($1, $2, $3, $4) as result',
        [roomId, hostUser, hostGuestToken, attackerHostToken],
      );
      claim.catch(() => undefined);

      expect(await waitForLock(clientA, pidB)).toBe(true);

      await clientA.query('commit');

      // Without the room lock the claim reads the pre-transfer host role,
      // waits on the secret row, then overwrites the revoked secret after the
      // commit and resolves with a working host pass.
      await expect(claim).rejects.toMatchObject({ code: '28000' });
    } finally {
      await clientA.query('rollback').catch(() => undefined);
      await clientB.query('rollback').catch(() => undefined);
      if (roomId !== undefined) {
        await clientA.query('delete from public.rooms where id = $1', [roomId])
          .catch(() => undefined);
      }
      await Promise.all([clientA.end(), clientB.end()]);
    }
  }, 20000);
});
