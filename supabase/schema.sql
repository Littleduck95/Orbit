-- Orbit's table. Run this once in the Supabase dashboard: SQL Editor, New
-- query, paste, Run. It is safe to run again.
--
-- Each of the app's saved keys (people, events, reminders, lists, theme,
-- your name) is one row, holding the same JSON text the app always stored.

create table if not exists public.orbit_data (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  key        text        not null check (char_length(key) between 1 and 200),
  value      text        not null check (octet_length(value) <= 10000000),
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- Row-level security is what makes the publishable key safe to ship: without
-- a policy that matches, a request sees and changes nothing. These let a
-- signed-in person reach their own rows and nobody else's.
alter table public.orbit_data enable row level security;

drop policy if exists "orbit_data: read own"   on public.orbit_data;
drop policy if exists "orbit_data: add own"    on public.orbit_data;
drop policy if exists "orbit_data: change own" on public.orbit_data;
drop policy if exists "orbit_data: remove own" on public.orbit_data;

create policy "orbit_data: read own" on public.orbit_data
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "orbit_data: add own" on public.orbit_data
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "orbit_data: change own" on public.orbit_data
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "orbit_data: remove own" on public.orbit_data
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Signed-out visitors get nothing at all, not even an empty table.
revoke all on public.orbit_data from anon;
grant select, insert, update, delete on public.orbit_data to authenticated;
