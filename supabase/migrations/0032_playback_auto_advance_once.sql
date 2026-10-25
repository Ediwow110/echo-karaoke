-- An automatic advance names the song that actually ended. Repeated delivery
-- must never skip the following song, including after an ambiguous HTTP loss.
create or replace function public.playback_next_if_current(
  p_room_id uuid,
  p_user_id text,
  p_host_token text,
  p_expected_song_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_current public.queue_songs;
begin
  if p_user_id is null or p_expected_song_id is null then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  v_room := private.require_host(p_room_id, p_host_token);
  perform private.require_live(v_room);

  select * into v_room from public.rooms r where r.id = p_room_id for update;
  if not found then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;
  perform private.require_live(v_room);

  if v_room.playback_state ->> 'currentSongId' is distinct from p_expected_song_id::text then
    return jsonb_build_object(
      'roomId', v_room.id, 'status', v_room.status,
      'playback', private.playback_json(v_room), 'advanced', false
    );
  end if;

  select * into v_current from public.queue_songs q
  where q.id = p_expected_song_id and q.room_id = p_room_id;
  if not found then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  v_room := private.advance_queue(v_room, v_current);
  perform private.log_room_event(p_room_id, null, 'skip');
  return jsonb_build_object(
    'roomId', v_room.id, 'status', v_room.status,
    'playback', private.playback_json(v_room), 'advanced', true
  );
end;
$$;

revoke all on function public.playback_next_if_current(uuid, text, text, uuid)
from public, anon, authenticated, echo_auth;
grant execute on function public.playback_next_if_current(uuid, text, text, uuid)
to service_role;
