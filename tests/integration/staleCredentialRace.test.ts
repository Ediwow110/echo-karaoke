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

type Fixture = {
  roomId: string;
  hostUser: string;
  hostGuestToken: string;
  hostToken: string;
  targetMemberId: string;
  newGuestToken: string;
  victimMemberId: string;
  songId: string;
  secondSongId: string;
};

async function createFixture(client: Client): Promise<Fixture> {
  const suffix = randomUUID().replace(/-/g, '');
  const code = roomCode();
  const hostUser = 'stale-host-' + suffix;
  const targetUser = 'stale-target-' + suffix;
  const hostGuestToken = token('g');
  const hostToken = token('h');
  const targetGuestToken = token('t');
  const newGuestToken = token('n');
  const victimUser = 'stale-victim-' + suffix;
  const victimGuestToken = token('v');

  const created = await client.query(
    'select public.create_room($1, $2, $3, $4, $5) as result',
    [code, hostUser, 'Stale Host', hostGuestToken, hostToken],
  );
  const roomId = created.rows[0].result.roomId as string;

  const joined = await client.query(
    'select public.join_room($1, $2, $3, $4, $5) as result',
    [code, targetUser, 'Stale Target', targetGuestToken, 50],
  );

  const victim = await client.query(
    'select public.join_room($1, $2, $3, $4, $5) as result',
    [code, victimUser, 'Stale Victim', victimGuestToken, 50],
  );

  const first = await client.query(
    'select public.queue_add($1, $2, $3, $4, $5, $6, $7, $8, $9) as result',
    [roomId, hostUser, hostGuestToken, hostToken, 'M7lc1UVf-VE', 'Stale One', null, null, null],
  );
  const second = await client.query(
    'select public.queue_add($1, $2, $3, $4, $5, $6, $7, $8, $9) as result',
    [roomId, hostUser, hostGuestToken, hostToken, '9bZkp7q19f0', 'Stale Two', null, null, null],
  );

  return {
    roomId,
    hostUser,
    hostGuestToken,
    hostToken,
    targetMemberId: joined.rows[0].result.memberId as string,
    newGuestToken,
    victimMemberId: victim.rows[0].result.memberId as string,
    songId: first.rows[0].result.songId as string,
    secondSongId: second.rows[0].result.songId as string,
  };
}

async function runAgainstHeldTransfer(
  command: (client: Client, fixture: Fixture) => Promise<unknown>,
): Promise<void> {
  const clientA = new Client({ connectionString: process.env.DATABASE_URL });
  const clientB = new Client({ connectionString: process.env.DATABASE_URL });
  await Promise.all([clientA.connect(), clientB.connect()]);

  let roomId: string | undefined;
  try {
    const fixture = await createFixture(clientA);
    roomId = fixture.roomId;

    // Hold the transfer open. It demoted the caller and revoked the old host
    // secret, but the transaction has not committed yet.
    await clientA.query('begin');
    await clientA.query(
      'select public.room_transfer_host($1, $2, $3, $4, $5) as result',
      [fixture.roomId, fixture.hostUser, fixture.hostToken, fixture.targetMemberId, fixture.newGuestToken],
    );

    const pidB = (await clientB.query('select pg_backend_pid() as pid')).rows[0].pid as number;
    const pending = command(clientB, fixture);
    pending.catch(() => undefined);

    expect(await waitForLock(clientA, pidB)).toBe(true);

    await clientA.query('commit');

    // Without the post-lock recheck the command acted with the pre-transfer
    // host pass. With it, the revoked pass is rejected under the room lock.
    await expect(pending).rejects.toMatchObject({ code: '28000' });
  } finally {
    await clientA.query('rollback').catch(() => undefined);
    await clientB.query('rollback').catch(() => undefined);
    if (roomId !== undefined) {
      await clientA.query('delete from public.rooms where id = $1', [roomId])
        .catch(() => undefined);
    }
    await Promise.all([clientA.end(), clientB.end()]);
  }
}

describe.skipIf(!runsHere)('post-lock credential revalidation', () => {
  it('rejects playback whose host pass was revoked by a waiting transfer', async () => {
    await runAgainstHeldTransfer((client, fixture) => client.query(
      'select public.playback_command($1, $2, $3, $4, $5) as result',
      [fixture.roomId, fixture.hostUser, fixture.hostGuestToken, fixture.hostToken, 'next'],
    ));
  });

  it('rejects a queue add whose host pass was revoked by a waiting transfer', async () => {
    await runAgainstHeldTransfer((client, fixture) => client.query(
      'select public.queue_add($1, $2, $3, $4, $5, $6, $7, $8, $9) as result',
      [
        fixture.roomId,
        fixture.hostUser,
        fixture.hostGuestToken,
        fixture.hostToken,
        'dQw4w9WgXcQ',
        'Stale song',
        null,
        null,
        null,
      ],
    ));
  });

  it('rejects host_command end after a waiting transfer', async () => {
    await runAgainstHeldTransfer((client, fixture) => client.query(
      'select public.host_command($1, $2, $3, $4) as result',
      [fixture.roomId, fixture.hostUser, fixture.hostToken, 'end'],
    ));
  });

  it('rejects host_command clear_queue after a waiting transfer', async () => {
    await runAgainstHeldTransfer((client, fixture) => client.query(
      'select public.host_command($1, $2, $3, $4) as result',
      [fixture.roomId, fixture.hostUser, fixture.hostToken, 'clear_queue'],
    ));
  });

  it('rejects host_remove_member after a waiting transfer', async () => {
    await runAgainstHeldTransfer((client, fixture) => client.query(
      'select public.host_remove_member($1, $2, $3, $4) as result',
      [fixture.roomId, fixture.hostUser, fixture.hostToken, fixture.victimMemberId],
    ));
  });

  it('rejects queue_remove after a waiting transfer', async () => {
    await runAgainstHeldTransfer((client, fixture) => client.query(
      'select public.queue_remove($1, $2, $3, $4, $5) as result',
      [fixture.roomId, fixture.hostUser, fixture.hostGuestToken, fixture.hostToken, fixture.songId],
    ));
  });

  it('rejects queue_reorder after a waiting transfer', async () => {
    await runAgainstHeldTransfer((client, fixture) => client.query(
      'select public.queue_reorder($1, $2, $3, $4, $5, $6) as result',
      [fixture.roomId, fixture.hostUser, fixture.hostGuestToken, fixture.hostToken, fixture.songId, 'down'],
    ));
  });

  it('rejects playback_report after a waiting transfer', async () => {
    await runAgainstHeldTransfer((client, fixture) => client.query(
      'select public.playback_report($1, $2, $3, $4, $5, $6) as result',
      [fixture.roomId, fixture.hostUser, fixture.hostToken, 10, 100, null],
    ));
  });

  it('rejects playback_next_if_current after a waiting transfer', async () => {
    await runAgainstHeldTransfer((client, fixture) => client.query(
      'select public.playback_next_if_current($1, $2, $3, $4) as result',
      [fixture.roomId, fixture.hostUser, fixture.hostToken, randomUUID()],
    ));
  });

  it('rejects vote_toggle after a waiting transfer', async () => {
    await runAgainstHeldTransfer((client, fixture) => client.query(
      'select public.vote_toggle($1, $2, $3, $4, $5) as result',
      [fixture.roomId, fixture.hostUser, fixture.hostGuestToken, fixture.hostToken, fixture.songId],
    ));
  });

  it('rejects touch_host after a waiting transfer', async () => {
    await runAgainstHeldTransfer((client, fixture) => client.query(
      'select public.touch_host($1, $2) as result',
      [fixture.roomId, fixture.hostToken],
    ));
  });
});
