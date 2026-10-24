-- Removing a guest whose song is currently playing must not leave the room
-- pointing at a queue row that the cascade just deleted. Advance to the next
-- queued song (or clear playback) before returning.

create or replace function public.host_remove_member(
  p_room_id uuid,
  p_user_id text,
  p_host_token text,
  p_member_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_member public.members;
  v_current public.queue_songs;
  v_was_playing boolean := false;
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;
  if p_member_id is null then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  v_room := private.require_host(p_room_id, p_host_token);
  perform private.require_live(v_room);

  -- Serialize with skip, advance, remove, and clear so the current-song read
  -- below cannot be replaced between the cascade and the repair.
  select * into v_room from public.rooms r where r.id = p_room_id for update;
  if not found then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;
  perform private.require_live(v_room);

  select * into v_member
  from public.members m
  where m.id = p_member_id
    and m.room_id = p_room_id
    and m.role = 'guest';

  if not found then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  v_was_playing := coalesce((v_room.playback_state ->> 'isPlaying')::boolean, false);

  if (v_room.playback_state ->> 'currentSongId') is not null then
    select * into v_current
    from public.queue_songs q
    where q.id = (v_room.playback_state ->> 'currentSongId')::uuid
      and q.room_id = p_room_id;
  end if;

  delete from public.members where id = v_member.id;

  perform private.log_room_event(
    p_room_id,
    null,
    'remove',
    jsonb_build_object('memberId', p_member_id)
  );

  if v_current.id is not null and v_current.member_id = v_member.id then
    v_room := private.advance_queue(v_room, v_current);
    -- advance_queue intentionally starts a skip. A paused room must stay
    -- paused when the reason was moderation, not a skip.
    if not v_was_playing then
      update public.rooms r
      set playback_state = jsonb_set(
        jsonb_set(r.playback_state, '{isPlaying}', 'false'::jsonb),
        '{updatedAt}',
        to_jsonb(now())
      )
      where r.id = p_room_id
      returning * into v_room;
    end if;
    perform private.log_room_event(
      p_room_id,
      null,
      'skip',
      jsonb_build_object('reason', 'member_removed', 'memberId', p_member_id)
    );
  end if;

  return jsonb_build_object('memberId', p_member_id, 'removed', true);
end;
$$;
revoke all on function public.host_remove_member(uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.host_remove_member(uuid, text, text, uuid)
  to service_role;
