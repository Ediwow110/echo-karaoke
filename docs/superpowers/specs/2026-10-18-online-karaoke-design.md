# Online Karaoke — Design Spec

Date: 2026-10-18
Status: Draft for review

> **Superseded 2026-10-23.** This document is the original design and still
> describes Supabase Edge Functions with Realtime/Presence sync. The shipped
> product replaced both: one Vercel Function (`api/router.ts`) behind Better
> Auth plus room capability passes, with polling against Neon Postgres. See
> `README.md` for the current contract. Kept for history.

## 1. Purpose

A login-free, private online karaoke app powered by YouTube. A host opens a room on a
shared screen; guests join from their phones by scanning a QR code or typing the room ID.
Guests can search YouTube, add songs to a shared queue, and control playback. Everyone in
the room sees who is present.

Success means: a group of people can start singing together in under a minute, from any
mix of devices, with no account creation, and the host screen stays in sync with every
phone remote.

## 2. Scope

### In scope (MVP)
- Create an unlisted room and receive a short room ID + QR code.
- Join a room by room ID or by scanning the QR code.
- Live participant roster showing everyone currently in the room.
- YouTube song search and adding songs to a shared, ordered queue.
- Guest playback control: play/pause, skip, and queue management.
- Host-only controls: end room, clear queue, lock guest control.
- Realtime synchronization between the host screen and all phones.

### Out of scope (deferred)
- User accounts, profiles, or persistent history.
- Venue operator dashboards, multi-room management, billing.
- Native mobile apps.
- Lyrics, pitch/tempo shifting, audio recording or mixing.
- Public/discoverable rooms or a room directory.

## 3. Architecture

```
Host screen (browser/TV)              Guest phones (browser via QR)
  - YouTube IFrame player              - Join + display name
  - Queue + now playing                - YouTube search + add
  - Participant roster                 - Playback + queue controls
  - Host controls                      - Participant roster
        |                                       |
        +------------- Supabase Realtime --------+
        |   (Postgres changes + Presence)        |
        v                                        v
  Supabase Postgres                     Supabase Edge Function
  rooms / members / queue_songs /       /search  (YouTube Data API v3,
  votes / room_events                   API key stays server-side)
```

- Frontend: React + TypeScript + Vite, Tailwind CSS. Two routes: host screen and
  guest remote, both served as a static SPA.
- Data + realtime: Supabase Postgres with Realtime subscriptions and Presence.
- Search: Supabase Edge Function calling YouTube Data API v3. The API key is never
  shipped to the browser.
- Playback: YouTube IFrame Player API, loaded only on the host screen.

## 4. Core flows

### 4.1 Create a room (host)
1. Host opens the app and taps "Create room".
2. Client generates a session, calls `create_room`, and receives the room code and a
   host control token.
3. The room code and host token are stored in the host's `localStorage` so a refresh
   reclaims the room.
4. The host screen shows the room ID, a QR code, and the join URL.

### 4.2 Join a room (guest)
1. Guest scans the QR code or enters the room ID.
2. Guest picks a display name (or accepts a generated one such as "Guest 42").
3. Client calls `join_room`, which validates the room is live and returns a guest
   session token.
4. Guest lands on the remote with search, queue, and control UI.

Join outcomes are surfaced explicitly: joined, room not found, room ended.

### 4.3 Search and add a song
1. Guest searches; the client calls the `search` edge function with the room's session.
2. Results (video ID, title, channel, thumbnail, duration) are shown.
3. Guest taps add; the client calls `add_song`, which appends at the next queue
   position atomically.
4. All room clients receive the queue change via Realtime.

**Search fallback:** song search requires a YouTube Data API v3 key configured in the
edge function. Until a key is configured (or when the API returns an error), the app
offers a paste-URL/ID fallback: the guest pastes a YouTube link or video ID, resolves
its title and thumbnail, and adds it to the queue. The fallback keeps the app usable
end to end without any API key; full search activates automatically once a key is set.

### 4.4 Playback and control
1. Playback state (current song, position, playing/paused) lives in `rooms`.
2. The host screen is the only device that produces audio/video.
3. Guest control commands update playback state; the host player follows.
4. Because browsers block autoplay with sound, the host screen may require one tap
   before audio starts; the UI prompts for it.

### 4.5 Presence and roster
- Durable membership is stored in `members`; live connection state uses Supabase
  Presence keyed by member ID.
- The roster lists connected members with their display name and role, and shows who
  added each queued song.
- Members are marked offline when their presence entry is dropped; the roster is not
  deleted so a reconnecting phone keeps its identity.

### 4.6 End a room
- Only the host token holder can end a room. Ending sets `status = ended`; guests see
  a clear "room ended" state and further changes are rejected.

## 5. Data model

- `rooms`: id, code (unique, unlisted), host_token_hash, status (live/ended),
  playback_state (jsonb: song_id, position_seconds, is_playing, updated_at),
  guest_control_locked, created_at, ended_at.
- `members`: id, room_id, display_name, role (host/guest), session_token_hash,
  joined_at, last_seen_at.
- `queue_songs`: id, room_id, member_id, video_id, title, channel_title, thumbnail_url,
  duration_seconds, status (queued/playing/played/skipped), position, created_at.
- `votes`: id, queue_song_id, member_id, created_at (unique per member + song).
- `room_events`: id, room_id, member_id, type, payload, created_at (join/leave/add/skip
  audit trail).

Realtime publishes row changes for `queue_songs`, `rooms.playback_state`, and
`members`; Presence covers live connection status.

## 6. Permissions and privacy

- Rooms are **unlisted, not authenticated**. The room code is the access capability.
  Anyone holding the code or QR can join and control playback.
- A guest session token scopes a client to one room.
- The host token grants host-only actions and is never displayed to guests.
- Future hardening (passwords, invite approval, rate limits) is deliberately deferred;
  the design must not claim the room is secret.

## 7. Error handling

- Room not found / already ended: explicit screen, no silent failure.
- Guest control locked: controls disabled with an explanation.
- YouTube quota or API errors: inline message plus retry; search failures never block
  the existing queue.
- Non-embeddable or removed video: mark the song unplayable and let the host skip it.
- Autoplay blocked: prompt the host to tap to start audio.
- Realtime disconnect: reconnect with backoff and re-sync full room state on recovery.
- Duplicate song additions: allowed, but surfaced so the host can remove duplicates.

## 8. Testing

- Unit: queue position assignment, vote aggregation, playback/skip reducers, room
  state transitions, room-code and token generation.
- Integration: `create_room`, `join_room`, `add_song` against a local Supabase;
  `search` with a mocked YouTube client for success, empty, quota, and error.
- End-to-end (Playwright): create room → open remote via QR/join URL → roster shows
  both users → search → add song → queue updates on the host screen → skip.
- Manual: real phone scanning the real QR code against the deployed app.

## 9. Confirmed decisions

- **Hosting:** Vercel for the SPA, Supabase for Postgres/Realtime/Edge Functions.
- **Display names:** free text, trimmed and length-limited, with a generated fallback
  ("Guest 42") when empty. No moderation system in MVP.
- **Queue reordering:** guests may reorder or remove only the songs they added; the host
  may reorder or remove any song.
- **Rate limiting:** cap guest song additions at 5 per minute per member to protect the
  shared YouTube API quota.
- **YouTube search:** Data API v3 via edge function when a key is configured; paste
  URL/ID fallback when it is not, or on API errors.
