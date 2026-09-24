-- Just enough of what Supabase provides for supabase/schema.sql to run
-- against a plain PostgreSQL: the two API roles, the auth.users table and
-- auth.uid(), which reads the signed-in user from the request settings the
-- way Supabase's does.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
