# Neon Full Stack Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move ECHO off Supabase entirely: the database onto Neon, the anonymous identity onto a self hosted Better Auth, and the thirteen operations onto one Vercel Function, without changing what a guest or a host sees.

**Architecture:** One Vercel Function on Node 24 serves the application API and the Better Auth handler on the same origin. The function holds two Neon credentials with separate grants: a service role that can run the authorized database operations and nothing else, and an auth role that can reach the Better Auth tables and nothing else. The browser signs in anonymously once, sends a bearer token with every call, and never holds a database credential.

**Tech Stack:** Neon Postgres 17, Better Auth 1.7 with the anonymous and JWT plugins, `@neondatabase/serverless`, Vercel Functions on Node 24, React 19 and Vite 8 unchanged.

## Global Constraints

- The authorization rules do not change. The same SQL decides who may do what, and the same 210 database assertions must pass before and after.
- The browser never receives a database credential, and the client bundle never contains a connection string.
- The `anon`, `authenticated` and `service_role` roles exist on Neon with the same meaning they have on Supabase, and no browser role holds any table privilege or any execute right on an authorized operation.
- Every new table in `public` is revoked from `anon` and `authenticated` at creation, including the tables Better Auth creates.
- The bearer token is verified before any database work happens, and only an anonymous identity is accepted.
- Write in English, present tense, active voice. No emojis, no em dashes, no Latin abbreviations.
- Every behavior change is written as a failing test first, and the test is run and watched to fail before the implementation.

---

### Task 1: The auth schema, the auth role, and the default privileges

**Files:**
- Create: `supabase/migrations/0020_auth_schema.sql`
- Modify: `supabase/migrations/0000_platform_compatibility.sql`
- Test: `supabase/tests/auth_role_test.sql`

**Interfaces:**
- Consumes: the platform compatibility migration from the data only work, already applied on Neon and on the local stack.
- Produces: the tables `public.user`, `public.session`, `public.account`, `public.verification` and `public.jwks`; the role `echo_auth` with rights only on those five tables; the default privilege fix.

- [ ] **Step 1: Generate the Better Auth schema SQL**

Run the Better Auth CLI against the Neon branch with the same configuration the function will use, and write the generated SQL to `supabase/migrations/0020_auth_schema.sql`.

```bash
npx @better-auth/cli@latest generate --config ./server/auth.ts --output supabase/migrations/0020_auth_schema.sql
```

Expected: a file with the `user`, `session`, `account`, `verification` and `jwks` tables.

- [ ] **Step 2: Write the failing test**

Create `supabase/tests/auth_role_test.sql` with this shape. The suite follows the shape of the other six files: it opens a transaction, makes its assertions, and ends with a rollback.

```sql
begin;
select no_plan();

select has_table('public', 'user', 'the auth user table exists');
select has_table('public', 'session', 'the auth session table exists');

select ok(
  not has_table_privilege('anon', 'public.user', 'select'),
  'anon cannot read the auth tables'
);
select ok(
  not has_table_privilege('authenticated', 'public.session', 'select'),
  'authenticated cannot read the auth sessions'
);
select ok(
  has_table_privilege('echo_auth', 'public.user', 'select'),
  'the auth role can read the auth users'
);

select ok(
  not has_function_privilege('anon', 'public.cleanup_ended_rooms', 'execute'),
  'anon cannot run the retention function'
);
select ok(
  not has_function_privilege('echo_auth', 'public.queue_add', 'execute'),
  'the auth role cannot run the queue operations'
);

select * from finish();
rollback;
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx supabase test db`
Expected: FAIL, with the auth tables missing.

- [ ] **Step 4: Add the role and the grants to the migration**

Append to `supabase/migrations/0020_auth_schema.sql`:

```sql
-- The auth role exists so the identity tables and the room tables are reached
-- with two different credentials. The auth role sees the identity tables and
-- nothing else, and the service role sees the room operations and nothing else.
do
$$
begin
  if not exists (select 1 from pg_roles where rolname = 'echo_auth') then
    create role echo_auth nologin;
  end if;
end
$$;

grant usage on schema public to echo_auth;
grant select, insert, update, delete on public.user, public.session, public.account, public.verification, public.jwks to echo_auth;

revoke all on public.user, public.session, public.account, public.verification, public.jwks from anon, authenticated;
```

- [ ] **Step 5: Fix the default privileges so a new table is never writable by a browser role**

Add to `supabase/migrations/0000_platform_compatibility.sql`, after the schema creation:

```sql
-- A new table in this schema must not be readable or writable by a browser
-- role unless a migration says so. The platform grants the browser roles
-- delete and truncate on new tables by default, which is the trap the audit
-- found.
alter default privileges in schema public
  revoke delete, truncate, references, trigger on tables from public, anon, authenticated;
alter default privileges in schema public
  revoke usage, select, update on sequences from public, anon, authenticated;
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx supabase db reset && npx supabase test db`
Expected: PASS, with 210 assertions from the existing suites and the new assertions from this one.

- [ ] **Step 7: Run the same chain against Neon**

```bash
npx supabase db push --db-url "$NEON_DATABASE_URL"
npx supabase test db --db-url "$NEON_DATABASE_URL"
```

Expected: PASS on both.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/0000_platform_compatibility.sql supabase/migrations/0020_auth_schema.sql supabase/tests/auth_role_test.sql
git commit -m "feat: add the auth schema, the auth role and the default privilege fix"
```

---

### Task 2: The server identity module

**Files:**
- Create: `server/auth/identity.ts`
- Create: `server/auth/jwks.ts`
- Test: `tests/unit/serverIdentity.test.ts`

**Interfaces:**
- Consumes: the bearer token from the `Authorization` header.
- Produces: `verifyBearerToken(token: string): Promise<{ userId: string; isAnonymous: boolean }>` and `requireAnonymousCaller(request: Request): Promise<{ userId: string; accessToken: string }>`.

The proof on 2026-10-22 established the facts this module relies on. A self hosted Better Auth with the anonymous and JWT plugins issues a token whose header is `alg: EdDSA` with a `kid`, whose payload carries `sub` equal to the user id, `isAnonymous: true` for an anonymous identity, and `exp` fifteen minutes after `iat`. The public key is published at `/api/auth/jwks`. The JWT endpoint is `GET /api/auth/token`. A second anonymous sign in while a session exists is refused with the message "Anonymous users cannot sign in again anonymously".

- [ ] **Step 1: Write the failing test**

Create `tests/unit/serverIdentity.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { verifyBearerToken } from '../../server/auth/identity';

describe('bearer token verification', () => {
  it('rejects a token that is not a well formed JWT', async () => {
    await expect(verifyBearerToken('not-a-token', 'http://127.0.0.1:9/jwks')).rejects.toThrow(/token/i);
  });

  it('rejects a token whose signature does not verify', async () => {
    const forged = 'eyJhbGciOiJFZERTQSIsImtpZCI6ImZha2UifQ.' +
      Buffer.from(JSON.stringify({ sub: 'user-1', isAnonymous: true })).toString('base64url') +
      '.ZmFrZS1zaWduYXR1cmU';
    await expect(verifyBearerToken(forged, 'http://127.0.0.1:9/jwks')).rejects.toThrow();
  });

  it('rejects a token that is not an anonymous identity', async () => {
    await expect(verifyBearerToken('token', 'http://127.0.0.1:9/jwks', { isAnonymous: false }))
      .rejects.toThrow(/anonymous/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/serverIdentity.test.ts`
Expected: FAIL, because the module does not exist.

- [ ] **Step 3: Implement the JWKS cache**

Create `server/auth/jwks.ts`:

```ts
export type Jwks = { keys: { kid: string; kty: string; crv: string; x: string; y: string }[] };

let cached: { keys: Jwks['keys']; fetchedAt: number } | null = null;
const TTL_MS = 10 * 60 * 1000;

export async function fetchJwks(url: string): Promise<Jwks['keys']> {
  if (cached !== null && Date.now() - cached.fetchedAt < TTL_MS) {
    return cached.keys;
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`the key set could not be read: ${response.status}`);
  }
  const body = (await response.json()) as Jwks;
  cached = { keys: body.keys, fetchedAt: Date.now() };
  return body.keys;
}
```

- [ ] **Step 4: Implement the verification**

Create `server/auth/identity.ts`:

```ts
import { fetchJwks } from './jwks';

export type VerifiedIdentity = { userId: string; isAnonymous: boolean };

export async function verifyBearerToken(
  token: string,
  jwksUrl: string,
  options: { isAnonymous?: boolean } = {},
): Promise<VerifiedIdentity> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('the token is not a JWT');
  }
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as { alg: string; kid?: string };
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
    sub?: string; isAnonymous?: boolean; exp?: number;
  };
  if (header.alg !== 'EdDSA') {
    throw new Error(`the token is signed with an unexpected algorithm: ${header.alg}`);
  }
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw new Error('the token carries no subject');
  }
  if (options.isAnonymous !== false && payload.isAnonymous !== true) {
    throw new Error('only an anonymous identity may use this endpoint');
  }
  const keys = await fetchJwks(jwksUrl);
  const key = keys.find((entry) => entry.kid === header.kid);
  if (key === undefined) {
    throw new Error('the token was signed with an unknown key');
  }
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    { kty: key.kty, crv: key.crv, x: key.x, y: key.y } as JsonWebKey,
    { name: 'Ed25519', namedCurve: 'Ed25519' },
    false,
    ['verify'],
  );
  const signature = Buffer.from(parts[2], 'base64url');
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`, 'utf8');
  const valid = await crypto.subtle.verify('Ed25519', publicKey, signature, signed);
  if (!valid) {
    throw new Error('the token signature does not verify');
  }
  if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) {
    throw new Error('the token has expired');
  }
  return { userId: payload.sub, isAnonymous: payload.isAnonymous === true };
}

export async function requireAnonymousCaller(request: Request): Promise<{ userId: string; accessToken: string }> {
  const header = request.headers.get('authorization') ?? '';
  if (!header.toLowerCase().startsWith('bearer ')) {
    throw new Error('a signed-in session is required');
  }
  const token = header.slice('bearer '.length).trim();
  const identity = await verifyBearerToken(token, process.env.BETTER_AUTH_JWKS_URL ?? '');
  return { userId: identity.userId, accessToken: token };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/serverIdentity.test.ts`
Expected: PASS.

- [ ] **Step 6: Prove the module against the real auth service**

Start the proof auth service from the 2026-10-22 experiment against the Neon branch, then run a script that signs in anonymously, fetches the token from `GET /api/auth/token`, and calls `verifyBearerToken` with the live key set. Expected: the verification returns the same user id that the sign in returned.

- [ ] **Step 7: Commit**

```bash
git add server/auth/identity.ts server/auth/jwks.ts tests/unit/serverIdentity.test.ts
git commit -m "feat: verify the anonymous bearer token against the published key set"
```

---

### Task 3: The Neon data client

**Files:**
- Create: `server/db/client.ts`
- Test: `tests/unit/neonDataClient.test.ts`

**Interfaces:**
- Consumes: the `DATABASE_URL` and `AUTH_DATABASE_URL` environment variables.
- Produces: `callOperation(name: string, args: unknown[]): Promise<unknown>` for the room operations and `callAuth<T>(sql: string, params: unknown[]): Promise<T>` for the auth side.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { operationCall } from '../../server/db/client';

describe('the operation call builder', () => {
  it('builds a parameterised call to the named operation', () => {
    const call = operationCall('queue_add', ['room-1', 'user-1', 'token-1']);
    expect(call.text).toContain('public.queue_add');
    expect(call.params).toEqual(['room-1', 'user-1', 'token-1']);
  });

  it('refuses an operation name that is not a plain identifier', () => {
    expect(() => operationCall('queue_add; drop table rooms', [])).toThrow(/operation/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/neonDataClient.test.ts`
Expected: FAIL, because the module does not exist.

- [ ] **Step 3: Implement the call builder and the two connections**

Create `server/db/client.ts`:

```ts
import { neon } from '@neondatabase/serverless';

const OPERATION_NAME = /^[a-z_][a-z0-9_]*$/;

export function operationCall(name: string, params: unknown[]): { text: string; params: unknown[] } {
  if (!OPERATION_NAME.test(name)) {
    throw new Error(`the operation name is not a plain identifier: ${name}`);
  }
  return { text: `select * from public.${name}(${params.map((_, index) => `$${index + 1}`).join(', ')})`, params };
}

export function serviceDatabase() {
  return neon(process.env.DATABASE_URL ?? '');
}

export function authDatabase() {
  return neon(process.env.AUTH_DATABASE_URL ?? '');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/neonDataClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Install the driver**

```bash
npm install @neondatabase/serverless
```

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json server/db/client.ts tests/unit/neonDataClient.test.ts
git commit -m "feat: reach the Neon database over the serverless driver"
```

---

### Task 4: The function runtime and the operation router

**Files:**
- Create: `api/[...path].ts`
- Create: `server/operations/index.ts`
- Create: `server/operations/createRoom.ts`
- Create: `server/operations/joinRoom.ts`
- Test: `tests/integration/operations.test.ts`

**Interfaces:**
- Consumes: `requireAnonymousCaller` from Task 2 and `serviceDatabase` from Task 3.
- Produces: a request handler that routes `/api/auth/*` to Better Auth and `/api/<name>` to one of the thirteen operations.

The operation names and their arguments do not change. The current list, with the arguments each one takes, is in `supabase/functions/*/index.ts`. Each operation keeps its name, its arguments, its return shape and its error codes.

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/operations.test.ts` with one case per operation, following the shape of `tests/integration/edgeRoomAuth.test.ts`: create a room, join it as a guest, read the room, add a song, vote, reorder, report the playback, and end the room. Every case asserts the same status code and the same body shape the Supabase function produced.

- [ ] **Step 2: Run the test to verify it fails**

Run: `LOCAL_SUPABASE_URL=... LOCAL_SUPABASE_ANON_KEY=... npx vitest run --config vitest.integration.config.ts`
Expected: FAIL, because the router does not exist.

- [ ] **Step 3: Create the router**

Create `api/[...path].ts`:

```ts
import { toNodeHandler } from 'better-auth/node';
import { auth } from '../../server/auth/auth';
import { handleOperation } from '../../server/operations';

export const config = { runtime: 'nodejs24' };

const authHandler = toNodeHandler(auth);

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/auth')) {
    return authHandler(request);
  }
  return handleOperation(request);
}
```

- [ ] **Step 4: Port one operation and prove it**

Port `create-room` first, because it is the only one that has to create a room, a member row, a host secret and two tokens. Prove it with the integration test.

- [ ] **Step 5: Port the remaining twelve operations, one at a time**

For each operation, port the handler, keep the error mapping in one place, and run the integration suite. The shared error mapping moves from `supabase/functions/_shared/room.ts` into `server/operations/errors.ts` and keeps the same code to status and message table.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run --config vitest.integration.config.ts`
Expected: PASS, with the same number of assertions the Supabase suite had.

- [ ] **Step 7: Commit**

```bash
git add api server/operations tests/integration/operations.test.ts
git commit -m "feat: serve the room operations from one Vercel Function"
```

---

### Task 5: The user id type

**Files:**
- Create: `supabase/migrations/0021_user_id_text.sql`
- Modify: `supabase/migrations/0001_room_core.sql`
- Test: `supabase/tests/room_core_test.sql`

**Interfaces:**
- Consumes: the Better Auth user id, which is a string such as `vGdO01aqOilu0iYCfBvRTOkW6o4CHjh6`.
- Produces: `public.members.user_id` as text, and `p_user_id` as text in every authorized operation.

- [ ] **Step 1: Write the failing test**

Add to `supabase/tests/room_core_test.sql`:

```sql
select has_column('members', 'user_id', 'the member user id column exists');
select ok(
  (select format_type(a.atttypid, a.atttypmod) from pg_attribute a
   join pg_class c on c.oid = a.attrelid
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'members' and a.attname = 'user_id') = 'text',
  'the member user id is text, because an auth user id is a string'
);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx supabase test db`
Expected: FAIL, because the column is a uuid.

- [ ] **Step 3: Change the column and every parameter**

Create `supabase/migrations/0021_user_id_text.sql`:

```sql
-- An auth user id is a string, so the member user id and every parameter that
-- carries one become text.
alter table public.members alter column user_id type text using user_id::text;
```

Then change the parameter types of the authorized operations that take a user id, in
`supabase/migrations/0001_room_core.sql` and the later migrations that replaced those
functions: `create_room`, `join_room`, `read_room_guest`, `read_room_host`,
`touch_member`, `queue_add`, `queue_remove`, `queue_reorder`, `vote_toggle`,
`playback_command`, `playback_report` and `host_command`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx supabase db reset && npx supabase test db`
Expected: PASS.

- [ ] **Step 5: Run the same chain against Neon**

```bash
npx supabase db push --db-url "$NEON_DATABASE_URL"
npx supabase test db --db-url "$NEON_DATABASE_URL"
```

Expected: PASS on both.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations
git commit -m "feat: carry the auth user id as text"
```

---

### Task 6: The client auth module

**Files:**
- Create: `src/lib/auth.ts`
- Delete: `src/lib/supabase.ts`
- Modify: `src/lib/edgeApi.ts`
- Test: `tests/unit/anonymousSession.test.ts`

**Interfaces:**
- Consumes: the same origin the app is served from.
- Produces: `ensureAnonymousSession(): Promise<string>` returning a bearer token, and `clearAnonymousSession(): void`. The names and the behaviour match the module they replace, so the rest of the client does not change.

- [ ] **Step 1: Write the failing test**

Replace `tests/unit/anonymousSession.test.ts` with a test of the new module:

```ts
import { describe, expect, it, vi } from 'vitest';

describe('the anonymous session', () => {
  it('signs in anonymously once and hands out the same bearer token afterwards', async () => {
    const signIn = vi.fn(async () => ({ user: { id: 'user-1' }, token: 'session-token' }));
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/auth/sign-in/anonymous')) {
        return new Response(JSON.stringify({ user: { id: 'user-1' }, token: 'session-token' }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/api/auth/token')) {
        return new Response(JSON.stringify({ token: 'bearer-token' }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 404 });
    }));

    const { ensureAnonymousSession } = await import('../../src/lib/auth');
    const first = await ensureAnonymousSession();
    const second = await ensureAnonymousSession();
    expect(first).toBe('bearer-token');
    expect(second).toBe('bearer-token');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/anonymousSession.test.ts`
Expected: FAIL, because the module does not exist.

- [ ] **Step 3: Implement the module**

Create `src/lib/auth.ts`:

```ts
let bearerToken: string | null = null;
let pending: Promise<string> | null = null;

async function requestToken(): Promise<string> {
  const response = await fetch('/api/auth/token', { credentials: 'include' });
  if (!response.ok) {
    throw new Error('Could not start a guest session. Try reloading the page.');
  }
  const body = (await response.json()) as { token?: string };
  if (typeof body.token !== 'string' || body.token.length === 0) {
    throw new Error('Could not start a guest session. Try reloading the page.');
  }
  bearerToken = body.token;
  return bearerToken;
}

export function ensureAnonymousSession(): Promise<string> {
  if (bearerToken !== null) {
    return Promise.resolve(bearerToken);
  }
  if (pending !== null) {
    return pending;
  }
  pending = requestToken().finally(() => {
    pending = null;
  });
  return pending;
}

export function clearAnonymousSession(): void {
  bearerToken = null;
}
```

- [ ] **Step 4: Point the transport at the new module**

In `src/lib/edgeApi.ts`, replace the import of the Supabase client with the import of
`ensureAnonymousSession` from `../../lib/auth`, and drop the Supabase URL and anon key
from the transport. The transport keeps its own header names and its error mapping.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/anonymousSession.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the whole unit suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/auth.ts src/lib/edgeApi.ts tests/unit/anonymousSession.test.ts
git commit -m "feat: sign in anonymously against the new auth service"
```

---

### Task 7: The sweep on room creation

**Files:**
- Create: `server/operations/sweep.ts`
- Modify: `server/operations/createRoom.ts`
- Test: `tests/integration/operations.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `public.cleanup_abandoned_rooms(p_before timestamptz)` and `public.cleanup_ended_rooms(p_cutoff timestamptz)`.
- Produces: `sweepAbandonedRooms(): Promise<number>` and `sweepEndedRooms(): Promise<number>`, both called from the create room path before the room is created.

- [ ] **Step 1: Write the failing test**

Add to `tests/integration/operations.test.ts`: create a room, stop its heartbeat, set its
creation time to forty minutes ago, create a second room, and assert that the first
room is gone and the second room exists.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --config vitest.integration.config.ts`
Expected: FAIL, because the sweep does not run.

- [ ] **Step 3: Implement the sweep**

Create `server/operations/sweep.ts`:

```ts
import { serviceDatabase } from '../db/client';

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
```

Call both from `createRoom` before it creates anything, and let a failure of either one
be ignored, because a room must still be creatable when the sweep cannot run.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --config vitest.integration.config.ts`
Expected: PASS.

- [ ] **Step 5: Correct the documentation**

In `README.md`, change the sentence that says a scheduled job deletes a room after
thirty minutes without a heartbeat. It now says that the sweep runs when a room is
created, and that a room whose members have not sent a heartbeat for thirty minutes is
deleted the next time somebody creates a room.

- [ ] **Step 6: Commit**

```bash
git add server/operations/sweep.ts server/operations/createRoom.ts tests/integration/operations.test.ts README.md
git commit -m "feat: sweep abandoned rooms when a room is created"
```

---

### Task 8: The deploy guard, the rewrite and the configuration

**Files:**
- Modify: `scripts/check-deploy-env.mjs`
- Modify: `vercel.json`
- Modify: `tests/unit/deployEnv.test.ts`
- Modify: `tests/unit/vercelConfig.test.ts`

**Interfaces:**
- Consumes: the production environment, which no longer holds a Supabase URL or an anon key.
- Produces: a guard that refuses a build whose client bundle could contain a database credential, and a rewrite that answers the API routes with the function instead of the app shell.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/deployEnv.test.ts`:

```ts
it('refuses a database connection string in the client environment', () => {
  const errors = checkDeployEnv({
    VITE_SUPABASE_URL: '',
    VITE_SUPABASE_ANON_KEY: '',
    ALLOWED_ORIGINS: 'https://app.example',
    VITE_DATABASE_URL: 'postgresql://user:pass@host/db',
  });
  expect(errors).toContain('VITE_DATABASE_URL must never reach the browser bundle.');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/deployEnv.test.ts`
Expected: FAIL, because the guard does not look at it.

- [ ] **Step 3: Rewrite the guard**

The guard no longer checks the Supabase URL and the anon key, because neither is in the
client environment any more. It checks three things:

- no `VITE_` variable carries a value that starts with `postgresql://`,
- the API base path, if one is set, is a relative path or an origin on the same host as
  the app,
- the CORS origin list still names at least one origin, because the preview deployment
  needs it.

- [ ] **Step 4: Write the failing test for the rewrite**

Add to `tests/unit/vercelConfig.test.ts`:

```ts
it('sends the API routes to the function and the rest to the app', () => {
  const source = config.rewrites?.[0]?.source ?? '';
  const route = new RegExp('^' + source + '$');
  expect(route.test('/api/create-room')).toBe(false);
  expect(route.test('/room/abc/host')).toBe(true);
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npx vitest run tests/unit/vercelConfig.test.ts`
Expected: FAIL, because the rewrite swallows the API routes.

- [ ] **Step 6: Exclude the API routes from the rewrite**

Change the rewrite source in `vercel.json` to:

```json
"source": "/((?!api/|assets/|fonts/|images/|favicon\\.svg|robots\\.txt|llms\\.txt).*)"
```

- [ ] **Step 7: Tighten the content security policy**

The browser no longer calls Supabase for anything, so the Supabase origins leave the
policy. In `vercel.json`, change `connect-src` to:

```
connect-src 'self' https://www.youtube.com
```

- [ ] **Step 8: Run both tests to verify they pass**

Run: `npx vitest run tests/unit/deployEnv.test.ts tests/unit/vercelConfig.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add scripts/check-deploy-env.mjs vercel.json tests/unit/deployEnv.test.ts tests/unit/vercelConfig.test.ts
git commit -m "fix: keep the database credential out of the browser bundle"
```

---

### Task 9: CI

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `package.json`

**Interfaces:**
- Consumes: the Neon project id, the Neon service role connection string and the Neon auth role connection string, as repository secrets.
- Produces: a database job that applies the chain to a Neon branch and runs the suite, and an integration job that runs the operations against the same branch.

- [ ] **Step 1: Rewrite the database job**

The job stops running `supabase start`. It applies the migrations to a branch created
through the Neon API, runs the database suite against it, and drops the branch at the
end, in a step that always runs.

- [ ] **Step 2: Add the integration job**

The job creates a branch, sets `DATABASE_URL`, `AUTH_DATABASE_URL` and
`BETTER_AUTH_SECRET`, starts the function with `vercel dev`, and runs
`npm run test:integration`.

- [ ] **Step 3: Add the repository secrets**

```bash
gh secret set NEON_DATABASE_URL --body "$NEON_DATABASE_URL"
gh secret set NEON_AUTH_DATABASE_URL --body "$NEON_AUTH_DATABASE_URL"
gh secret set BETTER_AUTH_SECRET --body "$BETTER_AUTH_SECRET"
gh variable set NEON_PROJECT_ID --body "$NEON_PROJECT_ID"
gh variable set NEON_REGION --body "aws-ap-southeast-1"
```

- [ ] **Step 4: Run the workflow**

```bash
git push origin master
gh run watch
```

Expected: the database job and the integration job both pass on a clean runner.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml package.json
git commit -m "ci: run the database and integration suites against a Neon branch"
```

---

### Task 10: Deployment and preview verification

**Files:**
- Modify: `docs/deployment/hosted-setup.md`
- Modify: `scripts/check-preview.mjs`

**Interfaces:**
- Consumes: the Vercel project `echo-karaoke` and the Neon project `plain-queen-50704361`.
- Produces: a deployment whose client bundle holds no credential, and a preview that passes the verifier.

- [ ] **Step 1: Set the Vercel environment**

```bash
vercel env add DATABASE_URL production
vercel env add AUTH_DATABASE_URL production
vercel env add BETTER_AUTH_SECRET production
```

Pin the function region to the Neon region so the hop from the function to the database
stays short:

```bash
vercel project inspect echo-karaoke
```

The function region must be `sin1`, which is the region of the Neon project
`aws-ap-southeast-1`.

- [ ] **Step 2: Extend the preview verifier**

The verifier gains a check that the served HTML and the served asset bundle carry no
`postgresql://` string, because a credential in the bundle is the one failure that
cannot be undone by a redeploy.

- [ ] **Step 3: Deploy and verify**

```bash
vercel deploy --prod
npm run verify:preview -- https://echo-karaoke.vercel.app
```

Expected: PASS.

- [ ] **Step 4: Rewrite the runbook**

The runbook now describes the Neon project, the auth service, the two credentials and
the sweep, and it no longer describes creating a Supabase project.

- [ ] **Step 5: Commit**

```bash
git add scripts/check-preview.mjs docs/deployment/hosted-setup.md
git commit -m "docs: record the Neon deployment and the auth service"
```

---

### Task 11: Re-run the audit against the new boundary

**Files:**
- Create: `docs/audit/2026-10-22-neon-boundary-audit.md`
- Modify: `docs/audit-plan.md`

**Interfaces:**
- Consumes: the finished stack.
- Produces: an audit that covers the new boundary, because the token that reaches the authorized operations is issued by a different service now.

- [ ] **Step 1: Audit the identity path**

Cover the token verification, the refresh, the failure path, and what happens when the
key set rotates.

- [ ] **Step 2: Audit the two credentials**

Cover what each role can reach, and prove that the auth role cannot run a room
operation and the service role cannot read the auth tables.

- [ ] **Step 3: Audit the boundary that did not move**

Confirm that the authorization SQL is unchanged, that the 210 assertions still pass on
both platforms, and that the browser still holds no database credential.

- [ ] **Step 4: Write the report and update the tracker**

Follow the shape of the report from 2026-10-22: the verdict, the method, the findings
with evidence, what was not covered, and the order to fix them.

- [ ] **Step 5: Commit**

```bash
git add docs/audit docs/audit-plan.md
git commit -m "docs: audit the Neon boundary"
```

---

## What this plan does not cover

- The two proven findings from the 2026-10-22 audit that are not in the rewritten code
  path. The shared song lookup pool is in the rewritten path, so it is fixed here; the
  host heartbeat that stops after an auth session replacement is not, and it stays open.
- The YouTube key, which is still a separate decision.
- The cleanup sweep, which is now the opportunistic one, so the guarantee changes from
  every five minutes to every room creation.
