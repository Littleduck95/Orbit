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

-- ---------------------------------------------------------------------------
-- Accounts: each person's username, the name friends see, and birthday.
-- Only the owner can read or change their own row. (Friends and what others
-- can see come later, through their own tables and rules.)

create table if not exists public.profiles (
  id           uuid        primary key references auth.users (id) on delete cascade,
  username     text        not null unique
                           check (username ~ '^[a-z][a-z0-9._]{2,19}$' and username !~ '[._]{2}' and username !~ '[._]$'),
  display_name text        not null check (char_length(btrim(display_name)) between 1 and 60),
  birthday     date        not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles: read own"   on public.profiles;
drop policy if exists "profiles: add own"    on public.profiles;
drop policy if exists "profiles: change own" on public.profiles;

create policy "profiles: read own" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy "profiles: add own" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);
create policy "profiles: change own" on public.profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

revoke all on public.profiles from anon;
grant select, insert, update on public.profiles to authenticated;

-- Orbit is for people 13 and older, checked here as well as in the app.
create or replace function public.check_profile() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.birthday > (current_date - interval '13 years')::date then
    raise exception 'Orbit is for people 13 and older';
  end if;
  if new.birthday < date '1900-01-01' then
    raise exception 'That birthday does not look right';
  end if;
  new.username := lower(new.username);
  new.display_name := btrim(new.display_name);
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists profiles_check on public.profiles;
create trigger profiles_check before insert or update on public.profiles
  for each row execute function public.check_profile();

-- Whether a username is free, for the sign-up form. Says nothing else about
-- whoever has it.
create or replace function public.username_available(name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.profiles where username = lower(btrim(name)));
$$;
revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

-- A sign-up with a password carries its username, name and birthday, and the
-- profile is made in the same step. Signing in with Google or an email link
-- carries none, so no profile is made, and Orbit asks for them once.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.raw_user_meta_data ? 'username' then
    insert into public.profiles (id, username, display_name, birthday)
    values (
      new.id,
      lower(new.raw_user_meta_data ->> 'username'),
      new.raw_user_meta_data ->> 'display_name',
      (new.raw_user_meta_data ->> 'birthday')::date
    );
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Deleting an account removes the sign-in, and with it (through the
-- references above) the profile and every saved row.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Tell the API about the table now. Without this it can briefly answer
-- "Could not find the table 'public.orbit_data' in the schema cache".
notify pgrst, 'reload schema';
