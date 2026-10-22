# Neon Full Stack Migration: Design Spec

Date: 2026-10-22
Status: Awaiting approval
Supersedes: `2026-10-22-neon-database-migration.md`, which moved the data only and
kept Supabase for the identity and the functions. The Supabase account cannot create a
third project, because the free plan limit of two active projects is counted across
every organization where the owner is an administrator. The identity and the functions
have to move too.

---

## 1. Purpose

ECHO runs on Supabase for three reasons: the Postgres database, the anonymous identity,
and the Deno Edge Functions that hold the service role. The database moves to Neon. The
identity becomes a self hosted Better Auth with the anonymous plugin. The functions move
to Vercel as one Node function that routes the thirteen operations.

The result is one provider for the data, one provider for the application, and no
per-IP sign-in budget anywhere.

## 2. What changes

| Piece | Today | After |
|---|---|---|
| Postgres database | Supabase project | Neon project |
| Anonymous identity | Supabase Auth, 30 per hour per IP | Better Auth anonymous plugin, no per-IP budget |
| The 13 operations | Supabase Edge Functions, Deno | one Vercel Function, Node 24 |
| The browser client | Vercel, React | Vercel, React, one auth call changed |
| Authorization logic | 19 migrations of SQL | the same 19 migrations |
| The cleanup sweep | pg_cron every 5 minutes | a sweep on room creation |
| Supabase | everything | nothing |

## 3. The architecture and the data flow

```
browser (Vercel, static)
   |
   |  POST /api/auth/sign-in/anonymous     once per browser
   |  POST /api/auth/token                  to refresh the bearer token
   |  POST /api/<operation>                 the room operations
   v
one Vercel Function, Node 24
   |-- Better Auth, mounted at /api/auth/*
   |-- the thirteen operations, routed by path
   |
   |  two roles, one database
   v
Neon Postgres, with the schema proven on it
```

The application and the API share an origin, so the browser makes same-origin requests.
There is no cross-origin request anywhere in the product, so there is no origin
allowlist for the API. The content security policy is tightened rather than left alone:
the browser no longer calls Supabase for anything, so the Supabase origins leave
`connect-src`, which leaves the app talking to its own origin and to YouTube.

The two database roles are separate credentials with separate grants. The room
operations use the service role, which can run the authorized operations and nothing
else. Better Auth uses its own role, which can read and write its own tables and
nothing else. Putting both in one function does not widen either grant, because the
grants live in the database and not in the process.

## 4. The identity

### 4.1 The plugin

Better Auth's anonymous plugin answers `sign-in/anonymous`. It creates a user flagged
`isAnonymous`, with a generated placeholder email and a session, and it refuses to sign
in anonymously again while a session is already anonymous. That refusal is the
behaviour ECHO wants: a browser keeps one identity instead of minting a new one on
every reload.

The JWT plugin signs the session so that the API can verify it without a network hop.
Its documented use is exactly this case: sharing an identity between a front end and a
back end on different domains.

### 4.2 What the browser does

The client calls `sign-in/anonymous` once, keeps the session, and asks for a bearer
token when it needs one. Every room call sends that token in the `Authorization` header,
which is the shape the client already uses. The Supabase client is replaced by a thin
auth module with the same three responsibilities: hold the session, hand out a token,
and report that no session could be started.

### 4.3 What the API does

The API verifies the token against the JWKS endpoint that Better Auth publishes, reads
the user id from the claim, and checks that the user is anonymous. The check against
the anonymous flag has to be confirmed against the claims the JWT plugin actually
issues, and that is the first task in the plan rather than an assumption.

### 4.4 What this removes

The hosted limit of thirty anonymous sign-ins per hour per IP address is gone, and with
it the venue problem: every guest phone on one network used to spend one budget, and
the thirty first guest of the hour could not join. Now every browser signs in once, on
its own credential, with no shared counter.

## 5. The function runtime

One Vercel Function, Node 24, with two route groups:

- `/api/auth/*` goes to Better Auth,
- `/api/<operation>` goes to one of the thirteen operations.

One deployment means one cold start for the whole API and one hostname to configure. The
Vercel plan allows twelve functions per deployment, so one is comfortably inside the
limit.

The alternative is Neon Functions on the same branch as the data. That removes the hop
between the function and the database and gives every branch its own API, which is
attractive for testing. It costs a second origin, so the content security policy gains
an entry, the origin allowlist comes back, and the client needs the API base URL as a
build variable. The Vercel route avoids all three.

The database is reached over HTTP with the Neon serverless driver, so no connection is
held between requests and no pool has to be sized. Every authorized operation is a
single statement, so a call is one round trip.

The function region is pinned to the same region as the Neon project, so the hop from
the function to the database stays short.

## 6. The database layer

### 6.1 The compatibility migration

`supabase/migrations/0000_platform_compatibility.sql` creates the `extensions` schema,
the `anon`, `authenticated` and `service_role` roles when they are missing, and puts the
`extensions` schema on the default search path. It is a no-op on Supabase.

**This is already written, applied and proven.** All twenty migrations apply to Neon,
the database suite passes 210 of 210 on Neon, the same suite passes 210 of 210 on
Supabase with the file in place, and the cleanup job is scheduled and active on Neon.

### 6.2 The two roles

The service role keeps its name and its privilege: `nologin bypassrls`, granted the
authorized operations and nothing else. It is the role the room operations connect as.

The auth role is new. It is created by the Better Auth schema migration and holds
rights only on the Better Auth tables. It is a separate credential so that the
function can hand each half of the work the narrowest grant available.

### 6.3 The user id type

Better Auth user ids are strings, not UUIDs. The `members.user_id` column and the
`p_user_id` parameters become text. The alternative is to configure Better Auth to
generate UUIDs, which is less code but ties the room schema to an auth setting. Text is
the simpler choice, and the comparison is a string comparison either way.

### 6.4 The sweep

The sweep runs when a room is created, as the previous spec decided. The abandoned room
sweep and the ended room retention both run from the create room path, using the same
functions the cron job called. The guarantee changes from every five minutes to
whenever a room is created, and the documentation says so.

## 7. The browser client

One module changes. `src/lib/supabase.ts` becomes `src/lib/auth.ts`, with the same
shape: a function that resolves a bearer token, and an error when no session can be
started. The room calls, the room pass headers and the retry behaviour are untouched.

The client no longer needs a Supabase URL or an anon key. It needs the API base URL,
which is the same origin it is served from, so it can be a relative path.

## 8. The tests

The database suite runs unchanged on Neon, and it already does.

The Edge integration suite changes only in where it points. It already drives the
operations over HTTP against a real database, so it needs one environment variable that
names the Neon branch.

Three new tests have to exist before the data layer is trusted:

- a parameterised call escapes a value the same way the old bridge escaped it,
- a function that returns no rows is distinguishable from one that raises,
- an expired or forged bearer token is rejected before any database work happens.

## 9. CI

The database job stops starting the local Supabase stack. It applies the migrations to
a Neon branch and runs the database suite there.

A new job runs the integration suite against a Neon branch and the function, so the
whole path is exercised on a clean runner before a merge.

The `verify` job does not change.

## 10. Deployment

The Vercel project keeps the two build variables for the client, which are now the API
base path and nothing else. The deploy guard has to be updated, because the Supabase URL
and anon key are no longer part of the environment.

Three server secrets are added:

- the Neon service role connection string,
- the Neon auth role connection string,
- the Better Auth secret.

The content security policy is tightened, because the browser no longer calls Supabase.
The API is same origin, so `connect-src` becomes `'self' https://www.youtube.com`.

The SPA rewrite has to stop swallowing the API routes. The current rule sends everything
that is not a static file to the app, so `/api/create-room` would be answered with the
app shell. The rule gains an exception for the API prefix.

## 11. Security: what does not change and what to re-check

What does not change:

- the browser holds no database credential,
- every operation verifies the bearer token and then the room pass,
- the authorized operations remain the only path to the tables,
- the browser roles hold no table privileges and cannot execute any authorized
  operation,
- the room passes stay in the browser's local storage.

What changes and has to be re-checked:

- the bearer token is now issued by Better Auth rather than by Supabase Auth, so the
  verification path, the refresh path and the failure path are new,
- the function holds two database credentials rather than one, so the grants and the
  secrets have to be checked together,
- the identity no longer comes with a platform that enforces a sign-in rate limit, so
  the rate limiting that ECHO does itself, the room creation cap and the song caps,
  become the only rate limits in the system.

The authorization logic itself does not need a new audit. It is the same SQL, and the
same 210 assertions run on both platforms. What does need a new pass is the boundary
around it: the token that reaches the authorized operations changed, so the audit that
closed on 2026-10-22 has to be re-run against the new path.

## 12. Failure modes

| Failure | Behaviour | Detection |
|---|---|---|
| Neon is unreachable | The operation returns a service error and the client shows the offline state | The integration suite fails |
| The auth service is unreachable | The client cannot start a session and says so plainly | The browser shows the session error |
| A token is forged or expired | The operation answers 401 before any database work | The new token test fails |
| The pool is exhausted | A request fails at the pool rather than in the database | The operations return a typed error, never a stack trace |
| The sweep does not run | Abandoned rooms stay until the next room is created | Documented, and a storage concern, not a correctness one |
| A connection string reaches a build | The deploy guard refuses the build | The guard already refuses a privileged key |

## 13. Rollback

The application reads one database and one auth service at a time. Rolling back means
pointing the Vercel environment at the previous deployment, which Vercel does for any
previous deployment of the project. The data is not moved during a rollback, so a
rollback after the cut over loses whatever was written to Neon since the cut over.

## 14. What is out of scope

- Any change to the client, the routes, the design or the queue behaviour, beyond the
  one auth module.
- Enabling email or social sign-in on Better Auth. The product is login free, and the
  anonymous plugin is the only sign-in that is switched on.
- The YouTube key, which is still a separate decision.
- The two proven audit findings, which are still open and still need fixing. The first
  of them, the shared song lookup pool, is in the code that this change rewrites, so
  it should be fixed as part of it rather than before it.

## 15. The work, in order

1. **Prove the identity.** Stand up Better Auth with the anonymous and JWT plugins
   against the Neon branch, confirm the claims the JWT plugin issues, confirm that a
   browser keeps one identity, and confirm that the anonymous flag is visible to the
   API. Everything else depends on this.
2. **The auth role and the auth schema.** The Better Auth tables and the role that
   owns them, with the grants that keep the room operations away from them.
3. **The function runtime.** The Vercel Function, the path router, the API base path,
   and the two database connections. The thirteen operations move one at a time, each
   with its authorization behaviour unchanged.
4. **The client auth module.** Replace the Supabase client with the Better Auth one,
   keeping the same interface, so the rest of the client does not change.
5. **The sweep on room creation**, with a test that a room created after an abandoned
   one does not inherit the abandoned rows.
6. **The CI jobs**, the database job against a Neon branch and the integration job.
7. **The deployment configuration**: the guard, the rewrite, the secrets, the preview
   verification.
8. **Re-run the audit** against the new boundary.

## 16. Open items for the owner

- The anonymous sign-in rate limit no longer exists, so the one item that needed a
  dashboard setting is gone.
- The Neon project is in `aws-ap-southeast-1`. The Vercel function region should be
  pinned to the same one.
- The Better Auth secret has to be generated and stored in the Vercel environment and
  nowhere else.
