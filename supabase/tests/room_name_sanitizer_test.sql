begin;
create extension if not exists pgtap with schema extensions;

select plan(1);

select is(
  public.create_room(
    'BDNM01',
    'room-name-bidi-user',
    'Host',
    repeat('g', 40),
    repeat('h', 40),
    U&'Stage \202Eevil\202C'
  ) ->> 'roomName',
  'Stage evil',
  'create_room strips bidi overrides from the room name'
);

select * from finish();
rollback;
