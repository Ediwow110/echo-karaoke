begin;
select no_plan();

create function public.__default_privileges_probe() returns integer
language sql as 'select 1';

select is(
  has_function_privilege('anon', 'public.__default_privileges_probe()', 'execute'),
  false,
  'anon has no execute on a new public function by default'
);

select is(
  has_function_privilege('authenticated', 'public.__default_privileges_probe()', 'execute'),
  false,
  'authenticated has no execute on a new public function by default'
);

create function public.__default_privileges_probe_granted() returns integer
language sql as 'select 1';
grant execute on function public.__default_privileges_probe_granted() to anon;

select is(
  has_function_privilege('anon', 'public.__default_privileges_probe_granted()', 'execute'),
  true,
  'an explicit grant still makes a new function executable'
);

drop function public.__default_privileges_probe();
drop function public.__default_privileges_probe_granted();

select * from finish();
rollback;
