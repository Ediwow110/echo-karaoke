begin;
create extension if not exists pgtap with schema extensions;

select no_plan();

-- Approval moved from a creation-time choice to a setting. The claim worth
-- pinning is what turning it off does to people already at the door: they are
-- admitted, not left ringing a bell nobody answers.

create temp table ctx on commit drop as
select
  (created ->> 'roomId')::uuid as room_id,
  (created ->> 'roomCode') as room_code,
  'ap-host' as host_user,
  repeat('h', 40) as host_token
from (
  select public.create_room(
    'AP00000000000001', 'ap-host', 'Approval Host',
    repeat('g', 40), repeat('h', 40), 'Approval', false, true, true
  ) as created
) s;

select public.join_room((select room_code from ctx), 'ap-waiting', 'First Waiting', repeat('a', 40));

select is(
  (select m.status from public.members m where m.user_id = 'ap-waiting'),
  'pending',
  'the guest starts at the door'
);

select throws_ok(
  $$select public.room_set_approval((select room_id from ctx), 'ap-waiting', repeat('a', 40), false)$$,
  '28000',
  null,
  'a guest pass cannot change the setting'
);

select is(
  (public.room_set_approval(
    (select room_id from ctx), (select host_user from ctx), (select host_token from ctx), false
  ) ->> 'admitted')::integer,
  1,
  'turning approval off admits whoever is waiting'
);

select is(
  (select m.status from public.members m where m.user_id = 'ap-waiting'),
  'active',
  'the waiting member is active now'
);

select is(
  public.read_room_guest((select room_id from ctx), 'ap-waiting', repeat('a', 40)) ->> 'status',
  'live',
  'and their next read is the live room'
);

select is(
  public.join_room((select room_code from ctx), 'ap-late', 'No Waiting', repeat('b', 40)) ->> 'status',
  'joined',
  'a new guest walks in while approval is off'
);

select is(
  (public.room_set_approval(
    (select room_id from ctx), (select host_user from ctx), (select host_token from ctx), true
  ) ->> 'requireApproval')::boolean,
  true,
  'the host can switch approval back on'
);

select is(
  public.read_room_guest((select room_id from ctx), 'ap-waiting', repeat('a', 40)) ->> 'status',
  'live',
  'switching it back on ejects nobody'
);

select is(
  public.join_room((select room_code from ctx), 'ap-another', 'Second Waiting', repeat('c', 40)) ->> 'status',
  'waiting',
  'and the next newcomer waits again'
);

select is(
  has_function_privilege('authenticated', 'public.room_set_approval(uuid, text, text, boolean)', 'execute'),
  false,
  'only the service role may change the setting'
);

select * from finish();
rollback;
