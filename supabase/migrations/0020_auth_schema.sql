-- A new table in this schema must not be readable or writable by a browser
-- role unless a migration says so. The platform grants the browser roles
-- delete and truncate on new tables by default, which is the trap the audit
-- found.
alter default privileges in schema public
  revoke delete, truncate, references, trigger on tables from public, anon, authenticated;
alter default privileges in schema public
  revoke usage, select, update on sequences from public, anon, authenticated;

create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" boolean not null, "image" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null, "isAnonymous" boolean);

create table "session" ("id" text not null primary key, "expiresAt" timestamptz not null, "token" text not null unique, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);

create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null);

create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);

create table "jwks" ("id" text not null primary key, "publicKey" text not null, "privateKey" text not null, "createdAt" timestamptz not null, "expiresAt" timestamptz, "alg" text, "crv" text);

create index "session_userId_idx" on "session" ("userId");

create index "account_userId_idx" on "account" ("userId");

create index "verification_identifier_idx" on "verification" ("identifier");

-- The auth role exists so the identity tables and the room tables are reached
-- with two different credentials. The auth role sees the identity tables and
-- nothing else, and the service role sees the room operations and nothing else.
do
$$
begin
  if not exists (select 1 from pg_roles where rolname = 'echo_auth') then
    create role echo_auth nologin;
  end if;
end
$$;

grant usage on schema public to echo_auth;
grant select, insert, update, delete on public."user", public."session", public."account", public."verification", public."jwks" to echo_auth;

revoke all on public."user", public."session", public."account", public."verification", public."jwks" from anon, authenticated;
