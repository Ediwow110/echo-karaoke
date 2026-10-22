begin;
select no_plan();

select has_table('public', 'user', 'the auth user table exists');
select has_table('public', 'session', 'the auth session table exists');

select ok(
  not has_table_privilege('anon', 'public.user', 'select'),
  'anon cannot read the auth tables'
);
select ok(
  not has_table_privilege('authenticated', 'public.session', 'select'),
  'authenticated cannot read the auth sessions'
);
select ok(
  has_table_privilege('echo_auth', 'public.user', 'select'),
  'the auth role can read the auth users'
);

select ok(
  not has_function_privilege('anon', 'public.cleanup_ended_rooms(timestamp with time zone)', 'execute'),
  'anon cannot run the retention function'
);
select ok(
  not has_function_privilege('echo_auth', 'public.queue_add(uuid, text, text, text, text, text, text, text, integer)', 'execute'),
  'the auth role cannot run the queue operations'
);

select * from finish();
rollback;
