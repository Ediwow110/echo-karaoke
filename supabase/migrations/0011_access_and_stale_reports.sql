-- A cheap host capability check lets the queue function authorize before it
-- calls the external YouTube metadata service.

create or replace function public.host_access_check(
  p_room_id uuid,
  p_user_id uuid,
  p_host_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;

  v_room := private.require_host(p_room_id, p_host_token);

  return jsonb_build_object(
    'roomId', v_room.id,
    'status', v_room.status
  );
end;
$$;

revoke all on function public.host_access_check(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.host_access_check(uuid, uuid, text) to service_role;

-- A late report from the previous video must not move the new song's clock.
drop function if exists public.playback_report(uuid, uuid, text, integer, integer);

create function public.playback_report(
  p_room_id uuid,
  p_user_id uuid,
  p_host_token text,
  p_position_seconds integer,
  p_duration_seconds integer default null,
  p_song_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_state jsonb;
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;

  v_room := private.require_host(p_room_id, p_host_token);
  perform private.require_live(v_room);

  if p_song_id is not null
     and (v_room.playback_state ->> 'currentSongId') is distinct from p_song_id::text then
    return private.playback_json(v_room);
  end if;

  v_state := v_room.playback_state;
  v_state := jsonb_set(v_state, '{positionSeconds}', to_jsonb(greatest(coalesce(p_position_seconds, 0), 0)));
  if p_duration_seconds is not null and p_duration_seconds > 0 then
    v_state := jsonb_set(v_state, '{durationSeconds}', to_jsonb(p_duration_seconds));
  end if;
  v_state := jsonb_set(v_state, '{updatedAt}', to_jsonb(now()));

  update public.rooms r set playback_state = v_state where r.id = p_room_id
  returning * into v_room;

  return private.playback_json(v_room);
end;
$$;

revoke all on function public.playback_report(uuid, uuid, text, integer, integer, uuid) from public, anon, authenticated;
grant execute on function public.playback_report(uuid, uuid, text, integer, integer, uuid) to service_role;
