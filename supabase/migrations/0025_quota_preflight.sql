-- Reject requests that cannot succeed before an outbound metadata lookup or a
-- shared daily budget charge. queue_add still performs the same checks under
-- the room lock; this function is a cheap preflight, not the source of truth.

create or replace function public.queue_add_preflight(
  p_room_id uuid,
  p_user_id text,
  p_guest_token text,
  p_host_token text,
  p_video_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_member public.members;
  v_is_host boolean := false;
  v_recent integer;
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;

  if p_host_token is not null then
    v_room := private.require_host(p_room_id, p_host_token);
    v_is_host := true;

    select * into v_member
    from public.members m
    where m.room_id = p_room_id and m.role = 'host'
    order by m.joined_at
    limit 1;

    if not found then
      raise exception 'UNAUTHORIZED' using errcode = '28000';
    end if;
  else
    v_member := private.require_guest(p_room_id, p_user_id, p_guest_token);
    select * into v_room from public.rooms r where r.id = p_room_id;
    perform private.require_guest_controls(v_room, v_member);
  end if;

  perform private.require_live(v_room);

  if p_video_id is null or p_video_id !~ '^[A-Za-z0-9_-]{11}$' then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.queue_songs q
    where q.room_id = p_room_id
      and q.video_id = p_video_id
      and q.status in ('queued', 'playing')
  ) then
    raise exception 'DUPLICATE_SONG' using errcode = '22023';
  end if;

  if v_is_host = false then
    select count(*) into v_recent
    from public.queue_songs q
    where q.member_id = v_member.id
      and q.created_at > now() - interval '1 minute';

    if v_recent >= 5 then
      raise exception 'RATE_LIMITED' using errcode = '22023';
    end if;
  end if;

  return jsonb_build_object('allowed', true, 'isHost', v_is_host);
end;
$$;

revoke all on function public.queue_add_preflight(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.queue_add_preflight(uuid, text, text, text, text)
  to service_role;

-- Read a daily counter without incrementing it. The search path uses this to
-- reject a room or global limit before charging the caller's personal day.
create or replace function public.peek_daily_rate_limit(
  p_subject text,
  p_bucket text,
  p_limit integer,
  p_time_zone text default 'America/Los_Angeles',
  p_now timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_window_start timestamptz;
  v_next_start timestamptz;
  v_count integer;
begin
  if p_subject is null or char_length(p_subject) not between 1 and 160 then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;
  if p_bucket is null or char_length(p_bucket) not between 1 and 80 then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 1000000 then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;
  if p_time_zone is null or not exists (
    select 1 from pg_catalog.pg_timezone_names z where z.name = p_time_zone
  ) then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  v_window_start := (
    date_trunc('day', v_now at time zone p_time_zone) at time zone p_time_zone
  );
  v_next_start := (
    date_trunc('day', (v_now at time zone p_time_zone) + interval '1 day')
      at time zone p_time_zone
  );

  select coalesce((
    select r.count
    from public.rate_limits r
    where r.subject = p_subject
      and r.bucket = p_bucket
      and r.window_start = v_window_start
  ), 0) into v_count;

  return jsonb_build_object(
    'allowed', v_count < p_limit,
    'count', v_count,
    'limit', p_limit,
    'retryAfterSeconds', greatest(
      1,
      ceil(extract(epoch from (v_next_start - v_now)))::integer
    )
  );
end;
$$;

revoke all on function public.peek_daily_rate_limit(text, text, integer, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.peek_daily_rate_limit(text, text, integer, text, timestamptz)
  to service_role;
