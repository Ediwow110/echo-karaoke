# Local CodeRabbit Review

Date: 2026-10-23
Scope: `376bf5b..HEAD` — host heartbeat, abuse controls, switch accessibility.
Mode: local reviewer agent. The hosted CodeRabbit CLI was not installed, so this is
not the CodeRabbit service result.

## Findings

### Critical, refuted: spoofed `x-forwarded-for` creates a fresh sign-in bucket

The reviewer claimed Vercel appends to `x-forwarded-for`, which would let a client
choose the rate-limit key. Tested against production: a request with
`x-forwarded-for: 203.0.113.250` created **no** `rate_limits` row for the HMAC of that
address (`before 0`, `after 0`, status 200). Vercel overwrites the header on this
deployment, so the first hop is the edge-observed address. No code change.

### Warning, fixed: a rate-limited client retried on every poll

`ensureAnonymousSession` cached only success. A 429 left the poll loop calling
`/api/auth/token` and the sign-in endpoint every four seconds; because
`consume_rate_limit` increments before evaluating `allowed`, the retries extended the
block. The client now stores the `Retry-After` deadline and message and rejects new
attempts locally until it expires; a success clears the block. A unit test proves one
network attempt per block and recovery after the deadline.

### Warning, fixed: a cross-site POST could spend the victim's quota

The limiter ran before Better Auth's origin check. A cross-site `no-cors` request
could consume the victim's IP bucket without ever creating a session. The limiter now
checks `Origin` against `resolveTrustedOrigins` before consuming; untrusted origins
get 403 and spend nothing. An integration test with a limit of one proves a blocked
cross-site request does not prevent the following same-site sign-in.

### Checked, no defect

- `0024_abuse_limits.sql`: the room row is locked before the member count, the count
  uses the post-lock snapshot, and `(room_id, user_id)` is unique. Concurrent joins
  cannot overshoot the cap.
- `touch_host`: the role-scoped update matches the one-host-per-room invariant, and
  the ended-room guards are covered by `heartbeat_test.sql`.
- `Toggle.tsx`: 44x44 target, 4px insets, and 3.89:1 OFF / 8.66:1 ON contrast are
  asserted by the browser test.

## Verification

- 237 unit tests pass.
- 7 integration tests pass, including the cross-site quota guard.
- 243 database assertions remain green (database code unchanged by this review).
- `npm run build` passes.

The review fixes are committed locally and are not deployed by this document.
