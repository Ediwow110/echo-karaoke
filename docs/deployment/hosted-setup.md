# Hosted Setup Runbook

Date: 2026-10-22
Status: Procedure only. No hosted project, no deployment, and no push were performed.

This runbook takes ECHO from a clean machine to a deployed, verified preview. Every
command is run from the repository root. Every value comes from a hosted account, so
each step names the value it needs and where to read it.

The local audit is already closed. Build passes, unit 180/180, database 210/210, Edge
17/17, and Playwright 9/9. This document does not repeat that work. It covers only the
steps that a hosted account makes possible.

## What this procedure produces

- A hosted Supabase project with the schema, the Edge Functions, and their secrets.
- A Vercel project that serves the built app with the CSP and the security headers.
- A git remote, so the CI workflow runs on every push.
- A verified preview, checked with `npm run verify:preview` and by hand.

## Values to collect first

| Value | Where it comes from | Used by |
|---|---|---|
| Project ref | Supabase dashboard, project settings, API | Every `supabase` command |
| Project URL | Supabase dashboard, project settings, API | `VITE_SUPABASE_URL` |
| Publishable anon key | Supabase dashboard, project settings, API | `VITE_SUPABASE_ANON_KEY` |
| App origin | The Vercel production domain | `ALLOWED_ORIGINS` |
| YouTube Data API key | Google Cloud console, YouTube Data API v3 | Edge secret `YOUTUBE_API_KEY` |

The YouTube key is optional. Without it the search box and the suggestion strip report
that search is not configured, and the paste a link path keeps working. The app never
sends the key to the browser.

## Step 1: Create the hosted Supabase project

Create a project in the Supabase dashboard. The local stack and the hosted project must
agree on the Postgres major version. The local `supabase/config.toml` pins
`major_version = 17`, so read the hosted project's major version in the dashboard
before applying migrations.

Then turn on the two Auth settings the app needs.

1. **Anonymous sign-ins must be on.** Dashboard, Authentication, Providers, Email. The
   app signs in without an account, so this switch is the product, not an option.
2. **Raise the anonymous sign-in rate limit.** Dashboard, Authentication, Rate Limits.
   The hosted default is 30 anonymous sign-ins per hour per IP address. A karaoke party
   puts every guest phone on one venue network, and a venue network is often a single
   public address, so all of those guests spend the same budget. With the default, the
   thirty first guest of the hour cannot join. Set it to the size of the largest room
   you expect, and read the value back before the party.

The local stack does not enforce this limit, so the Playwright suite passes without the
change. The limit only appears on the hosted project, and only in the real scenario.

## Step 2: Link the project and apply the migrations

```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push --dry-run
npx supabase db push
```

`--dry-run` prints the migrations before they run. Read that list. It must contain
every file in `supabase/migrations`, from `0001_room_core.sql` through
`0019_abandoned_room_cleanup.sql`, and nothing else.

Two migrations need attention on a hosted project:

- `0018_retention_and_creation_limits.sql` adds `public.cleanup_ended_rooms(cutoff)`,
  which refuses a cutoff less than one day old.
- `0019_abandoned_room_cleanup.sql` installs `pg_cron` and schedules
  `cleanup_abandoned_rooms(now() - interval '30 minutes')` every five minutes. It also
  creates the `members_room_id_last_seen_at_idx` and `rooms_created_at_abandoned_idx`
  indexes. Supabase enables `pg_cron` on hosted projects, so the schedule takes effect
  without a dashboard switch.

`supabase/seed.sql` holds local test data. `db push` does not run it unless
`--include-seed` is passed, and the production database does not need it.

Verify the schema landed:

```bash
npx supabase db dump --linked --schema public --file /tmp/echo-schema-check.sql
```

Then check the sweep on the hosted database, after a room has existed for more than 30
minutes with no heartbeat:

```sql
select jobname, schedule, active from cron.job where jobname = 'cleanup-abandoned-rooms';
```

## Step 3: Deploy the Edge Functions

```bash
npx supabase functions deploy
```

The deploy covers all thirteen functions. Do not pass `--no-verify-jwt`. Every function
verifies the anonymous Auth token, and the browser sends it.

The service role key is read from the function environment, so it must be present in the
hosted project. The runtime injects `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` by default, and the shared room module reads exactly
those names. A project that shows only the new publishable and secret keys still
carries the legacy `anon` and `service_role` keys under API Keys, Legacy API Keys.
Check that both legacy keys exist before deploying.

Confirm that the functions answer before continuing:

```bash
curl -i -X POST "https://<project-ref>.supabase.co/functions/v1/create-room" \
  -H "apikey: <publishable-anon-key>" \
  -H "authorization: Bearer <publishable-anon-key>" \
  -H "content-type: application/json" \
  -d '{"displayName":"Deploy Check"}'
```

A `401` with a JSON body means the function is deployed and the token check is on. The
gateway can answer the `401` before the function runs, and the function can answer it
on its own, so either way the deploy worked. A network error means the function is not
deployed.

## Step 4: Set the Edge secrets

```bash
npx supabase secrets set ALLOWED_ORIGINS=https://<app-origin>
npx supabase secrets set YOUTUBE_API_KEY=<youtube-data-api-key>
```

`ALLOWED_ORIGINS` is the CORS allowlist for the functions. An empty value reflects any
origin, which is convenient locally and too permissive in public. The list holds bare
origins, comma separated, with no path and no trailing slash. A request from an origin
that is not on the list is answered with the first allowed origin, so the browser
blocks it.

The two YouTube budget variables have safe defaults and only need a value if the
defaults are wrong for the account:

```bash
npx supabase secrets set YOUTUBE_DAILY_SEARCH_BUDGET=90 YOUTUBE_DAILY_POPULAR_BUDGET=200
```

The search budget must stay at or below 90. YouTube gives `search.list` its own bucket
of 100 calls per day, and 90 leaves headroom. The chart budget draws from the shared
pool of 10,000 units per day.

After a secret change, redeploy is not needed. The runtime reads the secret on the next
cold start. Confirm the list without printing the values:

```bash
npx supabase secrets list
```

## Step 5: Create the Vercel project and set its environment

Create the project in the Vercel dashboard and import the repository. The Vercel CLI is
not installed on this machine, so the dashboard is the shorter path. The Vercel project
needs three environment variables:

| Variable | Scope | Value |
|---|---|---|
| `VITE_SUPABASE_URL` | Build and runtime | The project URL from Step 1 |
| `VITE_SUPABASE_ANON_KEY` | Build and runtime | The publishable anon key from Step 1 |
| `ALLOWED_ORIGINS` | Build | The app origin, the same value as the Edge secret |

`ALLOWED_ORIGINS` must exist in the build environment, because `vercel.json` runs
`npm run verify:deploy` before the build and the guard refuses to build without it. The
build stops there on purpose. A build that skips the guard can carry the tunnel URL.

`vercel.json` also applies the CSP and the security headers. The CSP allows
`*.supabase.co` in `connect-src`. A project on a custom Supabase domain needs that host
added. `npm run verify:preview` reads `VITE_SUPABASE_URL` and checks that the CSP
allows the origin the app actually calls, so run it with that variable set.

## Step 6: Add the git remote

The repository has no remote, so the CI workflow has never run. The user approves each
push, so this step waits for that approval.

```bash
git remote add origin <repository-url>
git push -u origin master
```

The CI workflow needs two repository variables and one secret:

| Name | Kind | Value |
|---|---|---|
| `VITE_SUPABASE_URL` | Variable | The project URL |
| `ALLOWED_ORIGINS` | Variable | The app origin |
| `VITE_SUPABASE_ANON_KEY` | Secret | The publishable anon key |

The `production-artifact` job runs only when both variables are set. It runs the deploy
guard, builds the bundle with the production values, and uploads `dist` as an artifact.
The `verify` and `database` jobs always run, and the database job also runs the Edge
integration suite against a local stack.

The anon key is a publishable key, so it is not a secret in the usual sense, but the
workflow reads it from the secret store, so keep it there.

## Step 7: Build and check the bundle locally first

Run the guard with the production values before the first hosted build:

```bash
$env:VITE_SUPABASE_URL='https://<project-ref>.supabase.co'
$env:VITE_SUPABASE_ANON_KEY='<publishable-anon-key>'
$env:ALLOWED_ORIGINS='https://<app-origin>'
npm run verify:deploy
npm run build
```

The guard rejects a missing value, a non-HTTPS URL, the trycloudflare tunnel, a
wildcard origin, and an origin with a path or a trailing slash. The build output must
not contain the tunnel host. Check it:

```bash
Select-String -Path dist/assets/*.js -Pattern 'trycloudflare'
```

No match means the bundle is clean. A match means the environment leaked the tunnel
URL, and the build must be redone.

The current `.env` holds a tunnel URL because the phone tunnel rewrites it on every
run. That file is for the tunnel, not for production. The production build takes its
values from the environment, so the tunnel file can stay as it is.

## Step 8: Deploy and verify the preview

Deploy through the Vercel dashboard or the CLI, then run the preview verifier against
the deployment URL. Keep the production values in the environment, because the
verifier reads `VITE_SUPABASE_URL` to confirm that the CSP allows the Supabase origin
the app calls:

```bash
$env:VITE_SUPABASE_URL='https://<project-ref>.supabase.co'
npm run verify:preview -- https://<deployment-url>
```

The verifier checks the home page, the security headers, the CSP directives, the
Supabase origin, the SPA fallback on a deep route, the immutable caching on the hashed
assets, and the ECHO title. It fails when the deployment is missing any of them.

## Step 9: The preview checks that need a human

The verifier cannot judge these. Each one needs a phone, a real network, and a real
video.

1. **The camera and the QR.** Open the deployment on a phone over HTTPS, allow the
   camera, and scan the QR on the host screen. The camera needs a secure origin, so
   this is the check that a plain HTTP preview cannot pass.
2. **Playback.** Create a room, add a known embeddable video, and hear the music on
   the host screen. The player loads a frame from `www.youtube.com`, and the CSP
   allows that host. A video that YouTube refuses to embed is not a player fault: the
   app reports the failure and skips the song.
3. **The guest sync.** Join from the phone, add a song, and watch it appear on the
   host queue. The guest pause control reaches the host on the next poll, which is at
   most four seconds.
4. **The origin allowlist.** Open the deployment from a different origin and confirm
   the function answers with the allowlist origin instead of the request origin. The
   browser console must show no CORS error on the allowed origin.
5. **The venue network.** With the raised rate limit from Step 1, join from several
   phones on one network. A failure with "Could not start a guest session" means the
   anonymous sign-in budget is still too small.

## What not to ship

- A build made with the tunnel URL in `.env`. The tunnel host changes on every run and
  the bundle would call a host that no longer exists.
- A build made without `ALLOWED_ORIGINS`. The functions would reflect any origin.
- A bundle that contains the service role key or the YouTube key. Only the publishable
  anon key belongs in the browser.

## Rollback

The application is a static bundle, so a rollback is a redeployment of the previous
build. The database is not rolled back by a redeployment. A migration that must be
reversed needs a new forward migration, because the schema history is applied in order
and the hosted project keeps that history.

The cleanup sweep is the one scheduled job. Disable it without dropping the data:

```sql
select cron.unschedule('cleanup-abandoned-rooms');
```

## Open items that this procedure does not close

- The hosted cloud security scan was canceled and the rescan was declined. The external
  security input stays unverified. A green local suite is not scan coverage.
- CodeRabbit is not installed and no remote exists, so it cannot review a pull request
  until Step 6 is done.
- The live YouTube search path has never run against a real key. Step 4 adds the key,
  and the first search in a keyed environment is the proof.
- The anonymous Auth users are kept on purpose. A sweep job for them is not part of
  this procedure.
