// The grant-parity suite is vacuous when echo_service is absent, which is the
// case on a plain database. CI's branch is runtime-shaped, so a missing role
// there means the app would hit SQLSTATE 42501 on its first call. Fail before
// the suite reports a green it cannot mean.
import { Client } from 'pg';

const url = process.env.DATABASE_URL ?? '';
if (url.length === 0) {
  console.error('DATABASE_URL is required to verify the runtime role.');
  process.exit(1);
}

const client = new Client({ connectionString: url });
await client.connect();
try {
  const { rows } = await client.query(
    "select 1 as present from pg_roles where rolname = 'echo_service'",
  );
  if (rows.length === 0) {
    console.error('echo_service is absent: grant parity would pass vacuously on this branch.');
    process.exitCode = 1;
  } else {
    console.log('runtime role echo_service is present');
  }
} finally {
  await client.end();
}
