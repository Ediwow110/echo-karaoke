-- Keep the two credentials on their own side of the boundary.
-- The auth role is the only login that reads identity tables; the service role
-- is the only login that reaches the room schema. Supabase grants the service
-- role privileges on new public tables by default, so revoke explicitly.

revoke all on public."user", public."session", public."account",
  public."verification", public."jwks"
  from service_role;

revoke all on public.rooms, public.members, public.queue_songs,
  public.votes, public.room_events, public.rate_limits,
  public.youtube_search_cache
  from echo_auth;
revoke all on sequence public.room_events_id_seq from echo_auth;
revoke usage on schema private from echo_auth;
