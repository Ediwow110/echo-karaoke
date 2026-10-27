begin;
create extension if not exists pgtap with schema extensions;

select no_plan();

-- No single-connection pgTAP file can open the two transactions a deadlock
-- needs. What it can pin is the invariant that makes the cycle impossible:
-- every door operation locks the rooms row before it touches a members row,
-- matching the canonical order every queue and playback mutator follows.
--
-- The cycle this guards against: approve locks the member row FOR UPDATE, then
-- inserts a room_events row whose foreign key takes KEY SHARE on the room;
-- join_room holds the room FOR UPDATE and updates that same member row. Each
-- side waits for the other and Postgres aborts one with 40P01.

with approve_def as (
  select pg_get_functiondef(
    'public.room_approve_member(uuid, text, text, uuid)'::regprocedure
  ) as def
)
select ok(
  strpos(def, 'from public.rooms r where r.id = p_room_id for update') > 0
  and strpos(def, 'from public.members m') > 0
  and strpos(def, 'from public.rooms r where r.id = p_room_id for update')
    < strpos(def, 'from public.members m'),
  'approving a member locks the room before the member row'
)
from approve_def;

with reject_def as (
  select pg_get_functiondef(
    'public.room_reject_member(uuid, text, text, uuid)'::regprocedure
  ) as def
)
select ok(
  strpos(def, 'from public.rooms r where r.id = p_room_id for update') > 0
  and strpos(def, 'from public.members m') > 0
  and strpos(def, 'from public.rooms r where r.id = p_room_id for update')
    < strpos(def, 'from public.members m'),
  'rejecting a member locks the room before the member row'
)
from reject_def;

with transfer_def as (
  select pg_get_functiondef(
    'public.room_transfer_host(uuid, text, text, uuid, text)'::regprocedure
  ) as def
)
select ok(
  strpos(def, 'from public.rooms r where r.id = p_room_id for update') > 0
  and strpos(def, 'from public.members m') > 0
  and strpos(def, 'from public.rooms r where r.id = p_room_id for update')
    < strpos(def, 'from public.members m'),
  'transferring a room locks the room before either member row'
)
from transfer_def;

with admissions_def as (
  select pg_get_functiondef(
    'public.room_set_admissions(uuid, text, text, boolean)'::regprocedure
  ) as def
)
select ok(
  strpos(def, 'from public.rooms r where r.id = p_room_id for update') > 0,
  'closing the door locks the room row explicitly'
)
from admissions_def;

select * from finish();
rollback;
