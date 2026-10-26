# Moderated room entry — design

2026-10-26
Status: approved in design review by the owner; not yet implemented.
Migration slot: `0037` (`0036` is earmarked for the refresh double-spend lease).

## 1. Goal

Give the host control over who gets into a room. Today anyone holding the code or the QR is
inside immediately, with no host action and no way to stop them. The owner asked for three
things, and two of them already exist in part:

| Ask | Today | After this design |
| --- | --- | --- |
| Accept each guest | nobody is checked | new guests land in `pending` until the host admits them |
| Reject a guest | `host_remove_member` ejects someone already inside | reject removes a pending member, and removal stays as it is |
| Block future joins | `guest_control_locked` only stops song adds | `admissions_locked` refuses entry to anyone not already in |

## 2. What this is not

- **Not a ban list.** A rejected guest who re-enters the code lands back in `pending`. A real
  block needs a per-device table, which is its own decision.
- **Not automatic.** No auto-admit timer. A timer is this feature quietly turning itself off.
- **Not a change to the two existing locks.** "Guests can add songs" and "guest playback
  controls" mean what they mean today, and apply to admitted guests.
- **Not a queue of requests** with ordering, notes, or messages at the door.

## 3. The switches

Two booleans on `rooms`, matching the shape of the two locks already there:

- `require_approval` — **on for every new room** since `0038`, and changed from Room settings rather
  than chosen at create (product decision, 2026-10-26). Turning it off admits whoever is already
  waiting: the hosts who stop moderating should not leave a doorbell ringing. Rooms that existed
  before `0037` stay off, because the column defaulted to false there.
- `admissions_locked` — a mid-party action in Room settings, next to the other locks. The
  host's own QR and code stay visible; they simply refuse while set.

`guest_control_locked` stops being a setting at all in the same change: guests always add songs, so
the create form no longer offers it and Room settings no longer shows it. The column stays for the
rooms that already carry a value; nothing sets it from the app any more.

The asymmetry that remains is deliberate: approval is the standing policy, the lock is what you
reach for when the door is already busy.

## 4. Data

```sql
alter table public.rooms
  add column require_approval boolean not null default false,
  add column admissions_locked boolean not null default false;

alter table public.members
  add column status text not null default 'active',
  add constraint members_status_check check (status in ('active', 'pending'));
```

`members_one_host_per_room` from `0035` is unaffected: a pending row has `role = 'guest'`.

`room_events` gains `'approve'` and `'reject'`, which means the same
`drop constraint … alter table … add constraint` sequence `0035` used for `transfer_host`.

No new index. A room holds tens of members and every read is already scoped by `room_id`.

## 5. Joining

`public.join_room` keeps its signature and its validations, and the order of its checks
becomes:

1. unchanged validation and `ROOM_NOT_FOUND`;
2. unchanged `ROOM_ENDED` — an ended room is not a waiting room;
3. **new** `ROOM_CLOSED` when `admissions_locked` is set *and* this device has no member row in the
   room at all. Anyone the room already knows — admitted or still waiting — can get back to where
   they were; only a stranger is turned away;
4. the existing rejoin branch, unchanged, which preserves `status`;
5. a new member is inserted with `status = 'pending'` when `require_approval` is set, and
   `'active'` when it is not.

The return payload gains a top-level `status`: `'joined'` or `'waiting'`. The guest pass is
returned in both cases — a waiting guest needs it to poll.

Nothing is logged for a refused join: there is no member row to attribute it to, and a
count of people turned away at a locked door is not worth a table.

## 6. What a pending guest can see

This is the whole claim of the feature, so it lives in SQL rather than in a client that hides
things. `read_room_guest` grows a branch next to the existing `ended` branch: when the calling
member's `status` is `pending`, it returns only `roomId`, `status: 'waiting'`, the room's name,
the host's display name, and the caller's own `viewer`. It returns no queue, no roster, no
events, and no playback.

Participation is refused too, so a patched client cannot act as an admitted guest:
`private.require_guest` keeps its current job for reads and touches, and a new
`private.require_active_guest` guards `queue_add` and the guest path of `playback-command`,
raising `ROOM_PENDING`. Both call the same digest check; only the status test differs.

`private.room_roster` must aggregate active members only, so a guest reading the roster never
sees the names of people waiting. The host needs the door, so a separate
`private.room_door(room)` returns the pending rows and is included in the host read alone.

## 7. The host side

Two operations mirroring `room_transfer_host` and `host_remove_member`, both `require_host`
then `require_live`:

- `public.room_approve_member(room, host_token, member_id)` — sets `status = 'active'`, logs
  `approve`, returns `{ memberId, displayName, door }` with the freshly filtered waiting list.
- `public.room_reject_member(room, host_token, member_id)` — deletes the row, logs `reject`,
  returns the same shape. It returns the door rather than the roster because a roster computed
  before the change has just been proven stale, and the client re-reads anyway. Deleting is what
  revokes the pass: the digest goes with the row, so the next poll from that device
  authenticates as nothing.

Both refuse to act on a member who is not pending, and on the host's own row.

Room settings grows an "At the door" section listing pending names with Accept and Reject, and
the count surfaces as a badge on the Discover and Stage headers. The badge exists because the
host's natural position is watching a song, and a doorbell nobody sees is not a doorbell.

## 8. The client

- `verifyJoin` accepts `status: 'waiting'` and stores the pass exactly as it does today.
- `JoinRoomPage` navigates into the room either way; the room screen decides what to render.
- `GuestRoomPage` renders a waiting screen for `status: 'waiting'` — room name, "Waiting for
  <host> to let you in" — and keeps polling. `useRoomData` stops polling when the read says
  `ended` and must not do that for `waiting`.
- When a poll flips to a live room, the same component stops waiting with no reload.
- A rejected guest's next poll authenticates as nothing, which is the existing revoked-pass
  screen ("Your room pass is no longer valid. Return home and join the room again."). Naming the
  host there — "Rafa removed you" — would need a tombstone row kept for every rejection, or it
  would lie to anyone whose pass was rotated rather than revoked, and this design deliberately
  deletes the row. The generic copy is the honest signal; a guest who re-enters the code lands
  back at the door, where the host can admit them.
- `createRoom` sends the third permission toggle.

## 9. Failure modes

- **The host never notices.** The guest waits with a clear message. Accepted: the feature is
  opt-in, and the badge is the mitigation.
- **The host closes the room while someone waits.** `ended` is checked before `pending`, so
  they see the ended screen, not a false hope.
- **The host transfers the room with people waiting.** The door list comes from the host read,
  so the new host inherits it.
- **A waiting guest reloads.** They re-enter the code, the rejoin branch preserves `pending`,
  and they get the same screen with a fresh pass.
- **A locked room and an active member's reload.** The lock exempts existing members, so a
  closed door never strands someone who was already let in.

## 10. Migration and deploy order

Apply `0037` to Neon `main` before deploying the code, which is the standing rule: the new
build expects columns and functions the old schema does not have. The reverse order is also
survivable — every new column has a default, and the old client ignores the extra `status` key —
but the old guest client would render a `waiting` payload as an empty live room, so the window
is the deploy itself and should be short.

Grants follow the `0035` pattern: revoke from `public`/`anon`/`authenticated`, grant to
`service_role`, and the guarded `DO` block that grants to `echo_service` only when that role
exists.

## 11. Tests

pgTAP, one assertion per claim in section 6, which is where a mistake would actually leak:

1. with `require_approval`, a new join returns `waiting` and inserts `pending`;
2. a pending member's `read_room_guest` returns no `queue`, no `roster`, no `events`, no
   `playback` key at all;
3. a pending `queue_add` and guest `playback-command` raise `ROOM_PENDING`;
4. a pending `touch-member` and read still succeed, so the doorbell works;
5. approve flips the status and the same read then returns a queue;
6. reject deletes the row and the old pass then fails to authenticate;
7. `room_roster` excludes pending and `room_door` returns only pending;
8. `admissions_locked` refuses a new join with `ROOM_CLOSED` but admits an active member;
9. an existing active member is never affected by either switch, and a room created without
   the toggle behaves exactly as before;
10. a bystander and a demoted host cannot approve or reject.

Unit: the three client states, `verifyJoin` accepting `waiting`, the operation registry, and
the create payload carrying the third toggle. Live: the two-browser proof — host creates with
approval on, guest joins and sees the door, host accepts, guest's queue appears without a
reload, then the host locks and a third device is refused.

## 12. Out of scope

Block lists, auto-admit, messages or notes at the door, a mobile navigation change, capacity
changes, and any edit to the two existing guest permission locks.

## 13. The work, in order

1. `0037` migration, with the pgTAP file written first and red.
2. `approve-member` and `reject-member` operations, registry, and unit tests.
3. `join_room`, `read_room_guest`, `require_active_guest`, roster and door functions.
4. Client join and waiting states.
5. Host door UI, badge, and the create toggle.
6. Verify, apply to production, deploy, and run the two-browser proof.
