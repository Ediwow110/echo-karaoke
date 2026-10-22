-- A database-level guard for two people adding the same song at once.
-- The queue_add check gives the normal friendly error; this index closes the
-- race window. Played or skipped songs are outside the index, so a room may
-- sing the same song again later.

do $$
declare
  v_duplicates integer;
  v_unique integer;
begin
  select count(*) into v_unique
  from pg_class c
  join pg_index i on i.indexrelid = c.oid
  where c.relname = 'queue_songs_active_video_key' and i.indisunique = true;

  if v_unique = 0 then
    select count(*) into v_duplicates
    from (
      select q.room_id, q.video_id
      from public.queue_songs q
      where q.status in ('queued', 'playing')
      group by q.room_id, q.video_id
      having count(*) > 1
    ) duplicates;

    if v_duplicates > 0 then
      raise exception
        'Cannot create queue_songs_active_video_key: % room/video pairs already have active duplicates',
        v_duplicates;
    end if;

    create unique index queue_songs_active_video_key
      on public.queue_songs (room_id, video_id)
      where status in ('queued', 'playing');
  end if;
end;
$$;
