# Karaoke Room Security Blueprint

Status: Revised for renewed user review. Proposal only. No migrations, local database resets, hosted projects, or deployments have been performed.

## Security model

The app has no visible login. Each browser silently signs in with Supabase Anonymous Auth. The signed Auth JWT identifies a browser installation but does not authorize room data.

A guest joins a room by its short code or QR, then receives a cryptographically random 32-byte guest bearer token. The guest token is room-scoped. The members row stores only its SHA-256 digest. Every guest data request goes to an authenticated Supabase Edge Function, which validates the Supabase JWT and anonymous claim, looks up membership by (room_id, auth.uid()), compares the submitted guest token digest, validates room state and the requested operation, and then accesses the database. Auth alone, code alone, or room UUID alone cannot read room data.

The host receives a separate cryptographically random 32-byte host bearer token, stored only as a digest in a non-exposed private table. Every host read and control request uses an authenticated Edge Function that validates JWT and host token. The token follows the approved host reclaim behavior after Auth session replacement. Host and guest tokens are stored in their browser's localStorage, as the product spec requires. Any same-origin JavaScript can read either token; an XSS can take over the corresponding session. There is no recovery or rotation UI in MVP. If the host loses the host token, the room remains hostless.

Room codes use 16 Crockford Base32 characters, with 80 random bits. Code permits a join attempt only. Not-found and ended-room responses remain distinct as required by the approved UX. MVP has no custom join throttling or member cap, consistent with the spec's deferred join abuse controls; review Supabase Auth limits/CAPTCHA or trusted gateway throttling before public launch. Song additions have a separate product requirement: five per minute per member. Rooms remain live until the host ends them. There is no automatic expiry/cleanup, so abandoned rooms remain joinable and retain data.

## Data boundary and Edge Functions

The browser uses Supabase only for Anonymous Auth and HTTPS Edge Function invocation. It never calls PostgREST tables or application RPCs. Edge Functions use a server-only service-role Supabase client for database operations. The service-role key never enters browser environment, source, logs, or responses.

Because service_role bypasses RLS, Edge Functions are the authorization boundary. Each function verifies the JWT using Supabase Auth, requires an anonymous Auth user, validates body size/types/action/room ID, loads membership/secret by validated identity, compares the correct bearer-token hash, checks live/ended state and guest lock, and scopes every database query to the authorized room/member. Functions return typed allowlisted DTOs only. Never trust client member IDs, role fields, room state, or forwarded IP headers. Never log JWTs, tokens, hashes, service keys, or request bodies.

Functions:

- create-room: verify anonymous Auth; atomically create room and host member; generate 32-byte host token; store only SHA-256 digest in private table; return room ID, room code, member ID, host token plaintext once.
- join-room: verify anonymous Auth; validate normalized code/display name; return distinct not-found and ended errors; for a live room create a member and random guest token; store only SHA-256 digest; return room ID, member ID, display name, guest token plaintext once.
- guest-room-read: verify guest JWT, is_anonymous, membership, guest token and room state; return only safe live room state, roster, queue, votes and events for that room. For ended rooms return only room ID/status to a valid prior guest token.
- host-room-read: verify anonymous JWT and host token; return host room projection including playback and controls. Never require original Auth UID once valid host token passes.
- touch-member: verify guest JWT/token/membership; derive member from auth.uid and room on server; update server timestamp no more than once per ten seconds. Online means heartbeat within thirty seconds.
- queue-command: verify guest token or host token as applicable, live state, lock, action ownership and inputs. Guest operates only on own songs. Host can moderate any song while guest controls are locked. Enforce five song additions per minute per member and allocate position transactionally.
- playback-command: guest play/pause/skip validates guest token and unlocked status; host play/pause/skip validates host token and remains available while guests are locked. Skip advances by server queue order.
- host-command: verify host token; atomically end room, clear queue, lock/unlock controls, or moderate. End writes status ended and sends a final fixed invalidation notice; later room data calls fail except ended-status response.
- youtube-search / youtube-oembed: verify guest JWT/token/membership and live room before external calls. YouTube API key remains an Edge Function secret. Search returns up to ten normalized results. URL/ID paste works without search key.

The static SPA has no separate POST /api server. The only browser application API is Supabase Edge Functions. Atomic DB transactions may use private/internal SQL helpers. Revoke helper EXECUTE from PUBLIC, anon and authenticated; grant only to service_role. Keep helper schema private and unexposed. Browser direct table/RPC access must fail.

## Database

RLS is enabled on every karaoke table. Revoke SELECT/INSERT/UPDATE/DELETE from PUBLIC, anon, authenticated. Grant only the required DB operations to service_role. RLS is defense in depth, not the caller authorization boundary for service_role requests.

- public.rooms: id UUID primary key, normalized unique code, status live/ended, guest_control_locked, playback_state JSON, created_at, ended_at. No host UID or tokens.
- public.members: id UUID, room_id, Auth user_id, display_name, guest_token_hash bytea, role host/guest for attribution only, joined_at, last_seen_at. Unique room_id/user_id; indexes room_id/user_id and user_id/room_id. Never return token hash.
- private.room_host_secrets: room_id primary key references rooms, token_hash bytea, created_at. Not exposed to PostgREST. Service role only.
- public.queue_songs: id, room_id, member_id, video_id, metadata, status, position, created_at. Unique room_id/position; room/member indexes. Duplicate IDs allowed.
- public.votes: id, room_id, queue_song_id, member_id, created_at. Unique song/member and same-room relationships enforced.
- public.room_events: id, room_id, nullable member_id, allowlisted type/payload, created_at. No credentials.

Use UTC timestamptz, explicit constraints, foreign keys, and indexes. Edge Function response DTOs are the only browser-readable projections.

## Realtime

Do not publish karaoke tables for browser Postgres Changes. That path cannot validate a guest token kept in localStorage. The browser may subscribe to a private room topic using authenticated membership. The Edge Function server publishes only fixed empty room-changed and room-ended invalidation events after successful operations. Client broadcast INSERT is denied. No event payload includes room code/ID, names, rows, queue, votes, playback, tokens, or credentials. Clients refetch via guest-room-read or host-room-read with the corresponding token.

Presence keys are client-chosen and untrusted. Do not use Presence identity or payload as roster identity. Get names/roles/online labels only from guest-room-read and touch-member. After room end, send one room-ended invalidation, deny all other room data, and close channel authorization.

## Service-role and SQL function security

Service role is the only database client credential used by Edge Functions. It bypasses RLS and therefore every Edge Function must enforce authorization before database access and scope reads/writes to the validated room/member. Do not make service-role API key callable by clients or log it.

If SQL helpers are needed for transactions, keep them in private schema, not PostgREST-exposed, revoke EXECUTE from PUBLIC/anon/authenticated, and grant only to service_role. Use pinned search_path, fully qualified names, narrow inputs/outputs, and validate room/action invariants. Avoid SECURITY DEFINER where service_role can safely run the transaction directly. If SECURITY DEFINER is necessary, document exact owner privileges and test role membership/ACLs. Do not create custom BYPASSRLS roles unless a concrete SQL recursion issue requires one; service_role already provides the trusted server path.

## Local security tests

Use separate anonymous Auth users and local Edge Function requests.

1. Anon key alone and Auth-only callers cannot read/write karaoke tables or fetch room data.
2. Missing, malformed, wrong-room, wrong-member, or revoked guest token fails every guest endpoint.
3. Join unknown code returns not-found; ended code returns ended; live join creates member, returns guest token once and stores only hash.
4. Host token is returned once; wrong/missing token fails reads/commands; valid token works after Auth-session replacement; lost-token recovery is absent.
5. Direct PostgREST table access and direct application RPC calls fail for anon/authenticated. No token hash in responses/logs.
6. Guest read returns only its room; ended token returns only room ID/status. Host read requires host token.
7. Guest queue/vote/playback controls work unlocked and fail locked. Host controls and playback still work locked. Guest cannot alter another member's songs.
8. Five-per-minute song cap and concurrent position uniqueness hold. Invalid YouTube URLs or metadata errors create no rows.
9. Edge Function request schema/size/action checks reject malformed input; every DB operation scopes to validated room. No service-role key or JWT is logged.
10. Private Broadcast subscription denies nonmembers. Client cannot publish. Edge Function publishes only fixed empty event names and rejects/ignores client-supplied event payloads.
11. End-room emits a final room-ended event; subsequent data requests fail except valid guest ended-status response.
12. Scan source, client bundle, test output and logs for host/guest token hashes, service key, JWT, and YouTube key.

## Revised design decisions requiring confirmation

This replaces the previously approved direct-RLS/Postgres Changes design with a stricter Edge Function guest-token data boundary. Approve this revised plan before any migration:

1. Guest token is required on every guest data request. Anonymous Auth alone is insufficient.
2. Edge Functions use server-only service-role database access after verifying Anonymous Auth JWT, membership and guest/host token. Browser roles have no direct table grants.
3. Realtime carries fixed non-sensitive invalidation notices only; no browser Postgres Changes or row payloads.
4. Host/guest tokens stay in localStorage; same-origin XSS can steal them. Host-token loss has no recovery in MVP.
5. Keep room code 16 chars, five song additions/minute, guest lock semantics, and distinct not-found/ended outcomes.
6. No custom join rate limit/member cap or room expiry in MVP; rooms remain live until host ends them and abandoned rooms retain data.

## Implementation gates

- Verify local Supabase CLI/Auth/Edge Function versions and local auth config. Do not connect a hosted project.
- Test JWT verification, guest/host token hashing, request validation, no direct table grants, service-role scoping and secret absence before committing migration.
- Test non-sensitive Broadcast authorization and denied client publish.
- Production project, secrets and deployment require separate explicit authorization.

## Official documentation

- Anonymous Auth: https://supabase.com/docs/guides/auth/auth-anonymous
- RLS and service-role bypass: https://supabase.com/docs/guides/database/postgres/row-level-security
- Realtime authorization: https://supabase.com/docs/guides/realtime/authorization
- Realtime Presence: https://supabase.com/docs/guides/realtime/presence
- Database functions: https://supabase.com/docs/guides/database/functions
- Edge Function auth/secrets: https://supabase.com/docs/guides/functions/auth and https://supabase.com/docs/guides/functions/secrets
