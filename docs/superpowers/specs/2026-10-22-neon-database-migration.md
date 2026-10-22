# Neon Database Migration: Design Spec

Date: 2026-10-22
Status: Superseded by `2026-10-22-neon-full-stack-migration.md`
Supersedes: nothing. The storage engine moves. The product does not.

This spec moved the database only and kept Supabase Auth and the Supabase Edge
Functions. The Supabase account cannot create the project that would hold them, because
the free plan limit of two active projects is counted across every organization where
the owner is an administrator, so a second organization does not create a fresh quota.
The identity and the functions move as well, and that is the next spec.

---

## 1. Purpose

ECHO stores its rooms, members, queue, votes and events in a Postgres database. Today
that database is the one inside the Supabase project. This spec moves the data to Neon
and keeps everything else exactly where it is.

The reason is separation. The identity stays with the platform that issues it, the
functions stay on the runtime they are written for, and the data moves to a database
that gives cheap branches for testing a migration chain before it reaches production.

The anonymous sign-in limit is not the reason. That limit is a setting in the Supabase
dashboard, and raising it takes two minutes. A backend rewrite does not solve a setting.

## 2. What moves and what stays

| Piece | Today | After | Change |
|---|---|---|---|
| Postgres database | Supabase project | Neon project | moved |
| Anonymous identity | Supabase Auth | Supabase Auth | none |
| The 13 Edge Functions | Supabase Edge Functions, Deno | Supabase Edge Functions, Deno | data layer only |
| The browser client | Vercel, React | Vercel, React | none |
| Authorization logic | 19 migrations of SQL | the same 19 migrations | none |
| The cleanup sweep | pg_cron every 5 minutes | a sweep on room creation | changed |
| The Supabase project | the one being created | the one being created | none |

Nothing about the product changes for a guest or for a host. The browser never reaches
the database, so it keeps calling the same functions with the same anon key. Only the
server side of the functions changes, and only in the one place where it touches data.

## 3. The architecture and the data flow

Before:

```
browser -> Supabase Edge Function -> Supabase Postgres (service role)
```

After:

```
browser -> Supabase Edge Function -> Neon Postgres (privileged role)
```

The function still receives the anonymous Auth JWT and still verifies it against the
Supabase Auth server. The function still receives the room-scoped guest or host bearer
token and still verifies it against the digest in the database. The only change is the
last hop, which now goes to Neon over the pooled HTTPS endpoint.

That keeps the trust boundary where it is. The browser holds no database credential, the
functions hold a credential that can run the authorized operations and nothing else, and
the authorized operations remain the only path to the tables.

## 4. The database layer

### 4.1 The compatibility migration

A new file, `supabase/migrations/0000_platform_compatibility.sql`, runs first and is a
no-op on Supabase. It does three things that Supabase does for free on the platform and
a plain Postgres does not:

- creates the `extensions` schema,
- creates the `anon`, `authenticated` and `service_role` roles when they are missing,
- puts the `extensions` schema on the default search path of the database.

The search path change is safe. Every call inside the schema is schema qualified, the
authorized operations pin an empty search path, and the only unqualified extension
reference in the product is `gen_random_uuid()`, which lives in `pg_catalog` on
Postgres 13 and later.

### 4.2 The role model

Supabase's `service_role` is the role the functions connect as. Neon has no such role,
so the compatibility migration creates one with the same name and the same privilege:
`nologin bypassrls`. The migrations already revoke every table and every function from
`anon` and `authenticated` and grant the authorized operations to `service_role`, so the
existing grants carry over unchanged.

The functions connect with the Neon pooled connection string as an Edge secret. The
connection string is a credential, so it never enters the browser bundle and never
enters the repository.

### 4.3 The migrations on Neon

Neon runs Postgres 17. The local stack and the Supabase projects all run 17, so the
version matches and the schema has no version specific behaviour to worry about.

The `pg_cron` extension needs one Neonspecific step before migration 0019 applies. Neon
manages the `cron.database_name` parameter and needs a compute restart for it to take
effect:

1. set `cron.database_name` to the database name on the endpoint,
2. restart the compute,
3. apply the migration.

The sweep job is then scheduled and active, and the abandoned room suite passes.

## 5. The function data layer

The functions call the authorized operations through the Supabase client as an RPC:
`admin.rpc('queue_add', { p_room_id: ..., ... })`. There are 21 such calls across the
13 functions.

On Neon there is no PostgREST RPC bridge, so each call becomes a parameterised SQL call
to the same function, over the pooled HTTPS endpoint, using the serverless driver:

```ts
const rows = await sql`select * from public.queue_add(${roomId}, ${userId}, ${guestToken})`;
```

The function names, the argument names, the argument order, the return shapes and the
error behaviour all stay. The error mapping in the shared module reads the same codes,
because the SQL raises the same exceptions.

Two properties have to hold, and the tests have to prove both:

- The parameterised form must not change how a value is escaped. The serverless driver
  sends parameters separately, so a display name with a quote in it behaves the same way.
- A function that returns no rows must still be distinguishable from a function that
  raises. The shared module maps the SQLSTATE to the same error codes as before.

## 6. The cleanup sweep

On Supabase, `pg_cron` fires the abandoned room sweep every five minutes. On Neon the
cron worker only runs while the compute is awake, and Neon suspends idle computes. An
always on compute at the smallest size costs about 180 compute hours a month, and the
Neon free plan allows 100. Keeping the five minute guarantee would need a paid plan.

So the sweep moves to the moment it matters. The `create-room` function sweeps before it
creates a room:

- rooms whose members have not sent a heartbeat for thirty minutes are deleted,
- rooms that ended more than one day ago are deleted by the same call.

The sweep is the same function, with the same arguments, that the cron job called. The
only change is the caller. The create room path is the only path that adds rooms, so it
is the only path where reclaiming space is worth doing.

Both calls are bounded by their indexes, so the cost follows the number of stale rows
rather than the size of the table. The abandoned room sweep only considers rooms that
were created more than thirty minutes ago, and the retention call uses a cutoff of two
days, which is past the one day floor that the retention function refuses to go below.

The guarantee changes from "every five minutes" to "whenever a room is created". That is
a weaker promise, and the documentation has to say so plainly.

The same trigger runs the ended room retention, which is defined in migration 0018 and
is currently never called by anything. That closes the finding that the documented
retention never runs.

## 7. The browser client

No change. The client signs in anonymously against Supabase Auth and calls the Supabase
Edge Functions. It holds no database credential and never had one, so there is nothing
to move and nothing to re-audit.

The only environment values that change are the two build variables, and they keep their
names: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` still point at Supabase. The
Neon connection string is a server side secret and never becomes a `VITE_` variable.

## 8. Local development

The local Supabase stack stays for the functions and for the Auth server. The database
target becomes a Neon branch, so a developer gets an isolated copy of the schema without
anyone else's data in it.

The local loop becomes:

1. apply the migrations to the Neon branch,
2. run the database suite against it,
3. serve the functions locally with the Neon connection string in the environment.

Neon branches are cheap copies, so a branch per change is affordable where a second
local stack was not.

## 9. The tests

The database suite runs unchanged on both platforms. It already does, which is the
strongest evidence that the schema is portable.

The Edge integration suite changes only in where it points. It already drives the
functions over HTTP with a real database, so it needs one environment variable that
names the Neon branch instead of the local stack.

Two new tests have to exist before the data layer is trusted:

- a test that proves a parameterised call escapes a value the same way the old RPC
  bridge escaped it,
- a test that proves a function which returns no rows is distinguishable from one that
  raises.

## 10. CI

The `database` job stops starting the local Supabase stack. It applies the migrations to
a Neon branch and runs the database suite there. The branch is created by the Neon API
and dropped at the end of the job.

The `verify` job does not change.

The `production-artifact` job does not change.

## 11. Deployment

The Vercel production environment keeps its three variables. The Supabase project
becomes the one that holds Auth and the functions.

Two secrets are added to the Supabase project, where the functions read them:

- the Neon pooled connection string,
- `ALLOWED_ORIGINS`, which already exists and must list both the production origin and
  the stable preview alias.

The content security policy does not change, because the browser still talks to
Supabase and not to Neon.

## 12. Security: what does not change and what to re-check

What does not change:

- the browser holds no database credential,
- every function verifies the anonymous Auth JWT and then the room bearer token,
- the authorized operations remain the only path to the tables,
- the browser roles hold no table privileges and cannot execute any authorized
  operation,
- the guest and host passes stay in the browser's local storage.

What has to be re-checked, because it is new:

- the functions now hold a Neon credential that can run the authorized operations, so
  the credential handling and the pooler configuration need a look,
- the error mapping has to survive the change of the data access path, because an
  exception raised by a remote database can arrive differently from one raised by a
  local one,
- the Neon connection string must never reach the browser bundle, so the deploy guard
  has to check for it the way it now checks for a privileged key.

The authorization logic itself does not need a new audit. It is the same SQL, and the
same 210 assertions run on both platforms.

## 13. Failure modes

| Failure | Behaviour | Detection |
|---|---|---|
| Neon is unreachable | The function returns a service error and the client shows the offline state | The integration suite fails; the client already handles a failed read |
| The Neon pool is exhausted | A request fails at the pool rather than in the database | The functions return a typed error, never a stack trace |
| A migration fails on Neon | The branch is left half applied and is dropped by the job | The CI database job fails |
| The sweep does not run | Abandoned rooms stay until the next room is created | Documented, and the retention is a storage concern, not a correctness one |
| The connection string leaks into a build | The deploy guard refuses the build | The guard already refuses a privileged key |

## 14. Rollback

The data lives in two places during the migration window: Neon and the Supabase project.
The application reads one of them at a time, through the connection string in the
functions.

To roll back, the connection string in the Supabase project points at the Supabase
database again. The schema is identical in both, because the same migrations produced
both. No data moves during the rollback, so a rollback after the switch loses whatever
was written to Neon since the switch.

That is the one thing to be careful about: the switch is the point where the two copies
diverge. Cut over when the Supabase database holds nothing that matters, or accept the
divergence.

## 15. What is out of scope

- Moving the identity off Supabase Auth. Neon Auth cannot issue an anonymous identity,
  and self hosting Better Auth with the anonymous plugin means running and securing a
  new auth service.
- Moving the functions to Neon Functions or to Vercel. They talk to the database over
  HTTP, so they are runtime independent, and that port is a separate change.
- Raising the anonymous sign-in limit. It is a dashboard setting and it is not this
  change.
- Any change to the client, the routes, the design or the queue behaviour.

## 16. The work, in order

1. The compatibility migration. **Done and proven**: all 20 migrations apply to Neon,
   the database suite passes 210/210 on Neon, and the same suite passes 210/210 on
   Supabase with the file in place.
2. The Neon role and the connection string, wired into the shared module.
3. The 21 call sites, one function at a time, with the escape and the empty result
   tests written first.
4. The opportunistic sweep in the create room path, with a test that a room created
   after an abandoned one does not inherit the abandoned rows.
5. The local development loop against a Neon branch.
6. The CI database job against a Neon branch.
7. The deployment configuration, the cut over, and the rollback note.

## 17. Open items for the owner

- The Supabase project that holds Auth and the functions still has to be created. The
  account is at its limit of two active free projects in the first organization, and a
  second organization exists for this.
- The Supabase platform MCP is not authorized for the second organization yet, so the
  project has to be created with the command line tool.
- The anonymous sign-in limit has to be raised in the Supabase dashboard before the first
  party.
