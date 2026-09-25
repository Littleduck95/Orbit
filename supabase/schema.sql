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

-- ---------------------------------------------------------------------------
-- Profiles as others see them. Username and name are always visible, so
-- people can be found. Every other detail has its own setting: 'everyone',
-- 'friends', or 'me' (only you). Nobody reads another person's row
-- directly; the functions below hand out only what the settings allow. The
-- email you sign in with is never among it.

alter table public.profiles add column if not exists pronouns      text    not null default '' check (char_length(pronouns) <= 30);
alter table public.profiles add column if not exists bio           text    not null default '' check (char_length(bio) <= 300);
alter table public.profiles add column if not exists location      text    not null default '' check (char_length(location) <= 80);
alter table public.profiles add column if not exists phone         text    not null default '' check (char_length(phone) <= 40);
alter table public.profiles add column if not exists contact_email text    not null default '' check (char_length(contact_email) <= 200);
alter table public.profiles add column if not exists website       text    not null default '' check (website = '' or (website ~* '^https?://' and char_length(website) <= 300));
alter table public.profiles add column if not exists socials       jsonb   not null default '{}'::jsonb check (jsonb_typeof(socials) = 'object');
alter table public.profiles add column if not exists visibility    jsonb   not null default '{}'::jsonb check (jsonb_typeof(visibility) = 'object');
alter table public.profiles add column if not exists searchable    boolean not null default true;

-- Keeps only known socials (short text) and known visibility settings.
create or replace function public.clean_profile_extras() returns trigger
language plpgsql set search_path = '' as $$
declare
  k text;
  v jsonb;
  s jsonb := '{}'::jsonb;
  vis jsonb := '{}'::jsonb;
begin
  for k, v in select * from jsonb_each(coalesce(new.socials, '{}'::jsonb)) loop
    if k in ('instagram', 'x', 'tiktok', 'snapchat', 'linkedin') and jsonb_typeof(v) = 'string'
       and char_length(v #>> '{}') between 1 and 100 then
      s := s || jsonb_build_object(k, v #>> '{}');
    end if;
  end loop;
  for k, v in select * from jsonb_each(coalesce(new.visibility, '{}'::jsonb)) loop
    if k in ('pronouns', 'bio', 'location', 'birthday', 'phone', 'contact_email', 'website', 'socials', 'trips')
       and v #>> '{}' in ('everyone', 'friends', 'me') then
      vis := vis || jsonb_build_object(k, v #>> '{}');
    end if;
  end loop;
  new.socials := s;
  new.visibility := vis;
  return new;
end $$;

drop trigger if exists profiles_clean_extras on public.profiles;
create trigger profiles_clean_extras before insert or update on public.profiles
  for each row execute function public.clean_profile_extras();

-- Friendships: a request waits until the other person accepts. One row per
-- pair, whichever way it was asked.
create table if not exists public.friendships (
  requester    uuid        not null references auth.users (id) on delete cascade,
  addressee    uuid        not null references auth.users (id) on delete cascade,
  status       text        not null default 'pending' check (status in ('pending', 'accepted')),
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  primary key (requester, addressee),
  check (requester <> addressee)
);
create unique index if not exists friendships_pair
  on public.friendships (least(requester, addressee), greatest(requester, addressee));

-- Blocking someone hides you from them and them from you, and ends any
-- friendship or request between you.
create table if not exists public.blocks (
  blocker    uuid        not null references auth.users (id) on delete cascade,
  blocked    uuid        not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);

-- Neither table is read or written directly: everything goes through the
-- functions below, which check who is asking.
alter table public.friendships enable row level security;
alter table public.blocks enable row level security;
revoke all on public.friendships from anon, authenticated;
revoke all on public.blocks from anon, authenticated;

create or replace function public.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.friendships
    where status = 'accepted' and ((requester = a and addressee = b) or (requester = b and addressee = a)));
$$;

create or replace function public.is_blocked(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.blocks
    where (blocker = a and blocked = b) or (blocker = b and blocked = a));
$$;

-- How the viewer stands with someone: 'self', 'friends', 'sent' (asked, not
-- yet answered), 'received' (they asked), or 'none'.
create or replace function public.relation_to(other uuid, viewer uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when other = viewer then 'self'
    when exists (select 1 from public.friendships where status = 'accepted'
      and ((requester = viewer and addressee = other) or (requester = other and addressee = viewer))) then 'friends'
    when exists (select 1 from public.friendships where status = 'pending' and requester = viewer and addressee = other) then 'sent'
    when exists (select 1 from public.friendships where status = 'pending' and requester = other and addressee = viewer) then 'received'
    else 'none'
  end;
$$;

-- One profile, holding only what this viewer may see. Anything without a
-- setting counts as 'me'.
create or replace function public.profile_for(p public.profiles, viewer uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  rel text := public.relation_to(p.id, viewer);
  out jsonb := jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name, 'relation', rel);
  f text;
  lvl text;
  val jsonb;
begin
  foreach f in array array['pronouns', 'bio', 'location', 'birthday', 'phone', 'contact_email', 'website', 'socials'] loop
    lvl := coalesce(p.visibility ->> f, 'me');
    if rel = 'self' or lvl = 'everyone' or (lvl = 'friends' and rel = 'friends') then
      val := case f
        when 'pronouns' then to_jsonb(p.pronouns)
        when 'bio' then to_jsonb(p.bio)
        when 'location' then to_jsonb(p.location)
        when 'birthday' then to_jsonb(p.birthday)
        when 'phone' then to_jsonb(p.phone)
        when 'contact_email' then to_jsonb(p.contact_email)
        when 'website' then to_jsonb(p.website)
        when 'socials' then p.socials
      end;
      if val is not null and val <> '""'::jsonb and val <> '{}'::jsonb then
        out := out || jsonb_build_object(f, val);
      end if;
    end if;
  end loop;
  return out;
end $$;
revoke all on function public.profile_for(public.profiles, uuid) from public, anon, authenticated;
revoke all on function public.are_friends(uuid, uuid) from public, anon, authenticated;
revoke all on function public.is_blocked(uuid, uuid) from public, anon, authenticated;
revoke all on function public.relation_to(uuid, uuid) from public, anon, authenticated;

-- Finding people: usernames starting with what was typed, or names
-- containing it. People who turned off "Show me in search", and anyone
-- blocked either way, never appear.
create or replace function public.search_profiles(q text) returns setof jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  term text := lower(btrim(coalesce(q, '')));
  pat text;
begin
  if me is null then raise exception 'Not signed in'; end if;
  term := ltrim(term, '@');
  if char_length(term) < 2 then return; end if;
  pat := replace(replace(replace(term, '\', '\\'), '%', '\%'), '_', '\_');
  return query
    select public.profile_for(p, me)
    from public.profiles p
    where p.id <> me and p.searchable and not public.is_blocked(p.id, me)
      and (p.username like pat || '%' or lower(p.display_name) like '%' || pat || '%')
    order by (p.username = term) desc, (p.username like pat || '%') desc, p.username
    limit 20;
end $$;

-- One person by exact username, as their QR code or link opens it. Works
-- even when they are hidden from search, but never across a block.
create or replace function public.get_profile(uname text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  p public.profiles;
begin
  if me is null then raise exception 'Not signed in'; end if;
  select * into p from public.profiles where username = lower(ltrim(btrim(uname), '@'));
  if p.id is null or public.is_blocked(p.id, me) then return null; end if;
  return public.profile_for(p, me);
end $$;

-- Friends, requests both ways, each with what that person lets you see.
create or replace function public.my_friends() returns setof jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Not signed in'; end if;
  return query
    select public.profile_for(p, me) || jsonb_build_object('since', coalesce(f.responded_at, f.created_at))
    from public.friendships f
    join public.profiles p on p.id = case when f.requester = me then f.addressee else f.requester end
    where me in (f.requester, f.addressee)
    order by lower(p.display_name);
end $$;

-- Asking to be friends. If they already asked you, this accepts. Answers
-- with how you now stand.
create or replace function public.send_friend_request(target uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Not signed in'; end if;
  if target = me then raise exception 'That is you'; end if;
  if not exists (select 1 from public.profiles where id = target) or public.is_blocked(target, me) then
    raise exception 'That person could not be found';
  end if;
  update public.friendships set status = 'accepted', responded_at = now()
    where requester = target and addressee = me and status = 'pending';
  if not found then
    insert into public.friendships (requester, addressee) values (me, target) on conflict do nothing;
  end if;
  return public.relation_to(target, me);
end $$;

-- Answering someone's request.
create or replace function public.respond_friend_request(other uuid, accept boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Not signed in'; end if;
  if accept then
    update public.friendships set status = 'accepted', responded_at = now()
      where requester = other and addressee = me and status = 'pending';
  else
    delete from public.friendships where requester = other and addressee = me and status = 'pending';
  end if;
  return public.relation_to(other, me);
end $$;

-- Unfriending, or taking back a request you sent.
create or replace function public.remove_friend(other uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Not signed in'; end if;
  delete from public.friendships where (requester = me and addressee = other) or (requester = other and addressee = me);
  return 'none';
end $$;

create or replace function public.block_user(other uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Not signed in'; end if;
  if other = me then raise exception 'That is you'; end if;
  delete from public.friendships where (requester = me and addressee = other) or (requester = other and addressee = me);
  insert into public.blocks (blocker, blocked) values (me, other) on conflict do nothing;
end $$;

create or replace function public.unblock_user(other uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  delete from public.blocks where blocker = auth.uid() and blocked = other;
end $$;

-- The people you blocked, by name only.
create or replace function public.my_blocks() returns setof jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  return query
    select jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name)
    from public.blocks b join public.profiles p on p.id = b.blocked
    where b.blocker = auth.uid()
    order by p.username;
end $$;

revoke all on function public.search_profiles(text) from public, anon;
revoke all on function public.get_profile(text) from public, anon;
revoke all on function public.my_friends() from public, anon;
revoke all on function public.send_friend_request(uuid) from public, anon;
revoke all on function public.respond_friend_request(uuid, boolean) from public, anon;
revoke all on function public.remove_friend(uuid) from public, anon;
revoke all on function public.block_user(uuid) from public, anon;
revoke all on function public.unblock_user(uuid) from public, anon;
revoke all on function public.my_blocks() from public, anon;
grant execute on function public.search_profiles(text) to authenticated;
grant execute on function public.get_profile(text) to authenticated;
grant execute on function public.my_friends() to authenticated;
grant execute on function public.send_friend_request(uuid) to authenticated;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;
grant execute on function public.my_blocks() to authenticated;

-- ---------------------------------------------------------------------------
-- Notifications: what each person wants to hear about, when, and where
-- (push on the devices they turned it on for, and or an email). The sending
-- itself is done by the notify function (supabase/functions/notify), which
-- reads these with the service key; people only ever reach their own rows.

create table if not exists public.notification_prefs (
  user_id       uuid        primary key default auth.uid() references auth.users (id) on delete cascade,
  push          boolean     not null default false,
  email         boolean     not null default false,
  email_every   text        not null default 'daily' check (email_every in ('daily', 'weekly')),
  send_hour     smallint    not null default 9 check (send_hour between 0 and 23),
  time_zone     text        not null default 'UTC' check (char_length(time_zone) between 1 and 64),
  quiet_start   smallint    check (quiet_start between 0 and 23),
  quiet_end     smallint    check (quiet_end between 0 and 23),
  kinds         jsonb       not null default '{"birthdays": true, "reminders": true, "checkins": true, "events": true, "friend_requests": true}'::jsonb
                            check (jsonb_typeof(kinds) = 'object'),
  birthday_days smallint    not null default 1 check (birthday_days between 0 and 14),
  updated_at    timestamptz not null default now()
);

-- One row per device that turned push on. The endpoint is the address the
-- browser's push service gave that device.
create table if not exists public.push_subscriptions (
  endpoint   text        primary key check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  p256dh     text        not null check (char_length(p256dh) <= 200),
  auth       text        not null check (char_length(auth) <= 100),
  device     text        not null default '' check (char_length(device) <= 200),
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);

-- What has been sent, so nothing is sent twice. Only the notify function
-- reads or writes it.
create table if not exists public.notification_log (
  user_id uuid        not null references auth.users (id) on delete cascade,
  channel text        not null check (channel in ('push', 'email')),
  ref     text        not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, channel, ref)
);

alter table public.notification_prefs enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_log enable row level security;

drop policy if exists "notification_prefs: read own"   on public.notification_prefs;
drop policy if exists "notification_prefs: add own"    on public.notification_prefs;
drop policy if exists "notification_prefs: change own" on public.notification_prefs;
create policy "notification_prefs: read own" on public.notification_prefs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "notification_prefs: add own" on public.notification_prefs
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "notification_prefs: change own" on public.notification_prefs
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "push_subscriptions: read own"   on public.push_subscriptions;
drop policy if exists "push_subscriptions: add own"    on public.push_subscriptions;
drop policy if exists "push_subscriptions: change own" on public.push_subscriptions;
drop policy if exists "push_subscriptions: remove own" on public.push_subscriptions;
create policy "push_subscriptions: read own" on public.push_subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "push_subscriptions: add own" on public.push_subscriptions
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "push_subscriptions: change own" on public.push_subscriptions
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "push_subscriptions: remove own" on public.push_subscriptions
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.notification_prefs from anon;
revoke all on public.push_subscriptions from anon;
revoke all on public.notification_log from anon, authenticated;
grant select, insert, update on public.notification_prefs to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- Only the known kinds, each on or off.
create or replace function public.clean_notification_prefs() returns trigger
language plpgsql set search_path = '' as $$
declare
  k text;
  out jsonb := '{}'::jsonb;
begin
  foreach k in array array['birthdays', 'reminders', 'checkins', 'events', 'friend_requests'] loop
    out := out || jsonb_build_object(k, coalesce(case when jsonb_typeof(new.kinds -> k) = 'boolean' then (new.kinds -> k)::boolean end, true));
  end loop;
  new.kinds := out;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists notification_prefs_clean on public.notification_prefs;
create trigger notification_prefs_clean before insert or update on public.notification_prefs
  for each row execute function public.clean_notification_prefs();

-- ---------------------------------------------------------------------------
-- Part 4: the shared catalog. Performers, teams, shows, festivals and venues
-- that everyone's events can point at, so everyone's "Kansas City Chiefs" is
-- the same one and ratings can be added up. An entry comes from Wikidata (its
-- item id, Q and digits, is what makes it the same for everyone) or, for the
-- local band or the high school game Wikidata has never heard of, is made in
-- Orbit, where the same kind and name makes the same entry.
--
-- Events stay in each person's own saved data. What they choose to share
-- (Everyone or Friends) is copied here as an outing: the kind, title, date,
-- rating, their thoughts, and what it links to. Never who they went with,
-- never their private notes. The app sends the whole set each time it
-- changes (sync_outings), so this copy can never drift from the events.

create table if not exists public.catalog (
  id         uuid        primary key default gen_random_uuid(),
  kind       text        not null check (kind in ('performer', 'team', 'show', 'festival', 'venue')),
  name       text        not null check (char_length(name) between 1 and 200),
  about      text        not null default '' check (char_length(about) <= 300),
  source     text        not null check (source in ('wikidata', 'orbit')),
  source_id  text        not null check (char_length(source_id) between 1 and 300),
  created_by uuid        references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (source, source_id)
);
create index if not exists catalog_name on public.catalog (lower(name) text_pattern_ops);

create table if not exists public.outings (
  user_id    uuid         not null references auth.users (id) on delete cascade,
  event_id   text         not null check (char_length(event_id) between 1 and 100),
  kind       text         not null check (kind in ('Concert', 'Sports', 'Theater', 'Festival')),
  title      text         not null check (char_length(title) between 1 and 200),
  on_date    date         not null,
  rating     numeric(2,1) check (rating is null or (rating between 0.5 and 5 and rating * 2 = trunc(rating * 2))),
  review     text         not null default '' check (char_length(review) <= 2000),
  visibility text         not null check (visibility in ('everyone', 'friends')),
  updated_at timestamptz  not null default now(),
  primary key (user_id, event_id)
);

create table if not exists public.outing_links (
  user_id    uuid not null,
  event_id   text not null,
  catalog_id uuid not null references public.catalog (id) on delete cascade,
  primary key (user_id, event_id, catalog_id),
  foreign key (user_id, event_id) references public.outings (user_id, event_id) on delete cascade
);
create index if not exists outing_links_catalog on public.outing_links (catalog_id);

-- None of the three is read or written directly.
alter table public.catalog enable row level security;
alter table public.outings enable row level security;
alter table public.outing_links enable row level security;
revoke all on public.catalog from anon, authenticated;
revoke all on public.outings from anon, authenticated;
revoke all on public.outing_links from anon, authenticated;

-- Whether someone has opened their page to the whole web: off until they
-- turn it on. Part 5 has the pages themselves.
alter table public.profiles add column if not exists public_page boolean not null default false;
create or replace function public.page_is_public(who uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select public_page from public.profiles where id = who), false);
$$;
revoke all on function public.page_is_public(uuid) from public, anon, authenticated;

-- An entry as it is handed out: never who added it.
create or replace function public.catalog_entry(c public.catalog) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'kind', c.kind, 'name', c.name, 'about', c.about, 'source', c.source, 'source_id', c.source_id);
$$;

-- Whether this viewer may see an outing: their own always; otherwise one set
-- to Everyone, or to Friends when they are friends; never across a block. A
-- signed-out viewer (null) sees one set to Everyone only when its owner has
-- made their page public (see part 5).
create or replace function public.can_see_outing(owner uuid, vis text, viewer uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(owner = viewer, false)
    or (not public.is_blocked(owner, viewer)
        and ((vis = 'everyone' and (viewer is not null or public.page_is_public(owner)))
             or (vis = 'friends' and viewer is not null and public.are_friends(owner, viewer))));
$$;
revoke all on function public.catalog_entry(public.catalog) from public, anon, authenticated;
revoke all on function public.can_see_outing(uuid, text, uuid) from public, anon, authenticated;

-- Adds an entry, or hands back the one already there. For Wikidata the item
-- id decides; for one made in Orbit, the kind and the name, whatever its case
-- or spacing.
create or replace function public.catalog_add(p_kind text, p_name text, p_about text, p_source text, p_source_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  nm text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  sid text;
  c public.catalog;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if p_kind is null or p_kind not in ('performer', 'team', 'show', 'festival', 'venue') then raise exception 'Unknown kind of entry'; end if;
  if char_length(nm) not between 1 and 200 then raise exception 'An entry needs a name'; end if;
  if p_source = 'wikidata' then
    if coalesce(p_source_id, '') !~ '^Q[1-9][0-9]{0,11}$' then raise exception 'That is not a Wikidata item'; end if;
    sid := p_source_id;
  elsif p_source = 'orbit' then
    sid := p_kind || ':' || lower(nm);
  else
    raise exception 'Unknown source';
  end if;
  insert into public.catalog (kind, name, about, source, source_id, created_by)
    values (p_kind, nm, left(btrim(regexp_replace(coalesce(p_about, ''), '\s+', ' ', 'g')), 300), p_source, sid, me)
    on conflict (source, source_id) do nothing;
  select * into c from public.catalog where source = p_source and source_id = sid;
  return public.catalog_entry(c);
end $$;

-- Finding entries by any part of the name, the closest first, then the most
-- logged. outings counts only what this viewer may see; average is of ratings
-- shared with everyone.
create or replace function public.catalog_search(q text, p_kind text default null) returns setof jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  term text := lower(btrim(regexp_replace(coalesce(q, ''), '\s+', ' ', 'g')));
  pat text;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if char_length(term) < 2 then return; end if;
  pat := replace(replace(replace(term, '\', '\\'), '%', '\%'), '_', '\_');
  return query
    select public.catalog_entry(c) || jsonb_build_object('outings', s.n, 'average', s.avg)
    from public.catalog c
    cross join lateral (
      select count(*) filter (where public.can_see_outing(o.user_id, o.visibility, me)) as n,
             round(avg(o.rating) filter (where o.visibility = 'everyone' and public.can_see_outing(o.user_id, o.visibility, me)), 2) as avg
      from public.outing_links l join public.outings o on o.user_id = l.user_id and o.event_id = l.event_id
      where l.catalog_id = c.id
    ) s
    where lower(c.name) like '%' || pat || '%' and (p_kind is null or c.kind = p_kind)
    order by (lower(c.name) = term) desc, (lower(c.name) like pat || '%') desc, s.n desc, c.name
    limit 20;
end $$;

-- One entry's page, for anyone, signed in or not: the entry, its ratings shared with everyone (how many,
-- the average, and how many at each half star), and the outings this viewer
-- may see, newest first, each with who logged it and what else it links to.
create or replace function public.catalog_page(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  c public.catalog;
  out jsonb;
begin
  -- Signed-out visitors may look too (a public page links here), and see
  -- only what is shared with everyone.
  select * into c from public.catalog where id = p_id;
  if c.id is null then return null; end if;
  with mine as (
    select o.*, p.username, p.display_name
    from public.outing_links l
    join public.outings o on o.user_id = l.user_id and o.event_id = l.event_id
    join public.profiles p on p.id = o.user_id
    where l.catalog_id = c.id
  ), public_ratings as (
    select rating from mine where visibility = 'everyone' and rating is not null
      and public.can_see_outing(user_id, visibility, me)
  )
  select jsonb_build_object(
    'entry', public.catalog_entry(c),
    'ratings', (select count(*) from public_ratings),
    'average', (select round(avg(rating), 2) from public_ratings),
    'spread', (select jsonb_agg((select count(*) from public_ratings r where r.rating = g / 2.0) order by g) from generate_series(1, 10) g),
    'outings', coalesce((
      select jsonb_agg(x.j order by x.on_date desc, x.updated_at desc)
      from (
        select m.on_date, m.updated_at, jsonb_build_object(
          'by', jsonb_build_object('username', m.username, 'display_name', m.display_name, 'relation', public.relation_to(m.user_id, me)),
          'kind', m.kind, 'title', m.title, 'date', m.on_date, 'rating', m.rating, 'review', m.review,
          'links', coalesce((
            select jsonb_agg(public.catalog_entry(oc) order by oc.kind, oc.name)
            from public.outing_links ol join public.catalog oc on oc.id = ol.catalog_id
            where ol.user_id = m.user_id and ol.event_id = m.event_id and oc.id <> c.id
          ), '[]'::jsonb)
        ) as j
        from mine m
        where public.can_see_outing(m.user_id, m.visibility, me)
        order by m.on_date desc, m.updated_at desc
        limit 100
      ) x
    ), '[]'::jsonb)
  ) into out;
  return out;
end $$;

-- Replaces everything this person shares with the set given: an array of
-- { event_id, kind, title, date, rating, review, visibility, links: [catalog
-- ids] }. Anything malformed, still to come, or linking to nothing known is
-- left out. Answers with how many were kept.
create or replace function public.sync_outings(items jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  it jsonb;
  kept integer;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if not exists (select 1 from public.profiles where id = me) then raise exception 'Choose a username first'; end if;
  if jsonb_typeof(items) is distinct from 'array' then raise exception 'Expected a list'; end if;
  if jsonb_array_length(items) > 2000 then raise exception 'Too many to share at once'; end if;
  delete from public.outings where user_id = me;
  for it in select value from jsonb_array_elements(items) loop
    begin
      if jsonb_typeof(it) <> 'object' or (it ->> 'date')::date > current_date + 1 then continue; end if;
      insert into public.outings (user_id, event_id, kind, title, on_date, rating, review, visibility)
        values (me, it ->> 'event_id', it ->> 'kind', btrim(it ->> 'title'), (it ->> 'date')::date,
                (it ->> 'rating')::numeric, btrim(coalesce(it ->> 'review', '')), it ->> 'visibility')
        on conflict do nothing;
      if not found then continue; end if;
      insert into public.outing_links (user_id, event_id, catalog_id)
        select me, it ->> 'event_id', c.id from public.catalog c
        where c.id::text in (
          select jsonb_array_elements_text(case when jsonb_typeof(it -> 'links') = 'array' then it -> 'links' else '[]'::jsonb end) limit 10
        )
        on conflict do nothing;
    exception when others then
      null; -- this one is left out; the rest still go
    end;
  end loop;
  -- An outing linking to nothing says nothing about the catalog.
  delete from public.outings o where o.user_id = me
    and not exists (select 1 from public.outing_links l where l.user_id = me and l.event_id = o.event_id);
  select count(*) into kept from public.outings where user_id = me;
  return kept;
end $$;

revoke all on function public.catalog_add(text, text, text, text, text) from public, anon;
revoke all on function public.catalog_search(text, text) from public, anon;
revoke all on function public.catalog_page(uuid) from public;
revoke all on function public.sync_outings(jsonb) from public, anon;
grant execute on function public.catalog_add(text, text, text, text, text) to authenticated;
grant execute on function public.catalog_search(text, text) to authenticated;
grant execute on function public.catalog_page(uuid) to anon, authenticated;
grant execute on function public.sync_outings(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Part 5: public pages. Each person has a page (/u/username, and one per
-- year) with what they have chosen to show: the profile details, outings and
-- trips each set to Everyone or Friends. Signed-in people see it by those
-- settings. Signed-out visitors, anyone on the web, see only what is set to
-- Everyone, and only once its owner turns on public_page: "Everyone" meant
-- everyone in Orbit before pages existed, so nobody is put on the open web
-- without saying so.
--
-- Trips live in each person's own saved data. When they choose to show them
-- (visibility.trips), the trips they have taken are copied here: title,
-- dates, rating, highlight, and each stop's name, country, US state and a
-- position rounded to about a kilometre. Never who went, never notes or
-- photos, and never trips still to come, which would say when someone is
-- away from home.

-- public_page, whether signed-out visitors may see a page at all, is added
-- in part 4 above, where outings first need it.

create table if not exists public.shared_trips (
  user_id    uuid         not null references auth.users (id) on delete cascade,
  trip_id    text         not null check (char_length(trip_id) between 1 and 100),
  title      text         not null check (char_length(title) between 1 and 200),
  start_date date         not null,
  end_date   date         check (end_date is null or end_date >= start_date),
  rating     numeric(2,1) check (rating is null or (rating between 0.5 and 5 and rating * 2 = trunc(rating * 2))),
  highlight  text         not null default '' check (char_length(highlight) <= 300),
  stops      jsonb        not null default '[]'::jsonb check (jsonb_typeof(stops) = 'array' and jsonb_array_length(stops) <= 50),
  updated_at timestamptz  not null default now(),
  primary key (user_id, trip_id)
);
alter table public.shared_trips enable row level security;
revoke all on public.shared_trips from anon, authenticated;

-- Replaces the trips this person shows with the set given: an array of
-- { trip_id, title, start, end, rating, highlight, stops: [{ name, lat, lng,
-- country, state }] }. Nothing is kept while their trips are set to Only me.
-- Anything malformed or still to come is left out. Answers with how many
-- were kept.
create or replace function public.sync_trips(items jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  vis text;
  it jsonb;
  st jsonb;
  stops jsonb;
  kept integer;
begin
  if me is null then raise exception 'Not signed in'; end if;
  select coalesce(visibility ->> 'trips', 'me') into vis from public.profiles where id = me;
  if vis is null then raise exception 'Choose a username first'; end if;
  if jsonb_typeof(items) is distinct from 'array' then raise exception 'Expected a list'; end if;
  if jsonb_array_length(items) > 1000 then raise exception 'Too many to share at once'; end if;
  delete from public.shared_trips where user_id = me;
  if vis = 'me' then return 0; end if;
  for it in select value from jsonb_array_elements(items) loop
    begin
      if jsonb_typeof(it) <> 'object' or (it ->> 'start')::date > current_date + 1 then continue; end if;
      stops := '[]'::jsonb;
      for st in select value from jsonb_array_elements(case when jsonb_typeof(it -> 'stops') = 'array' then it -> 'stops' else '[]'::jsonb end) limit 50 loop
        if jsonb_typeof(st) = 'object' and (st ->> 'lat')::float8 between -90 and 90 and (st ->> 'lng')::float8 between -180 and 180 then
          stops := stops || jsonb_build_array(jsonb_build_object(
            'name', left(coalesce(st ->> 'name', ''), 200),
            'lat', round((st ->> 'lat')::numeric, 2), 'lng', round((st ->> 'lng')::numeric, 2),
            'country', left(coalesce(st ->> 'country', ''), 100), 'state', left(coalesce(st ->> 'state', ''), 100)));
        end if;
      end loop;
      insert into public.shared_trips (user_id, trip_id, title, start_date, end_date, rating, highlight, stops)
        values (me, it ->> 'trip_id', btrim(it ->> 'title'), (it ->> 'start')::date, (it ->> 'end')::date,
                (it ->> 'rating')::numeric, left(btrim(coalesce(it ->> 'highlight', '')), 300), stops)
        on conflict do nothing;
    exception when others then
      null; -- this one is left out; the rest still go
    end;
  end loop;
  select count(*) into kept from public.shared_trips where user_id = me;
  return kept;
end $$;

-- One person's page, for anyone: their profile as this viewer may see it,
-- the years with anything in them, and the trips and outings this viewer may
-- see (all of them, or one year's). A signed-out visitor gets only the name
-- and username, with hidden set, unless the page is public. Nothing across a
-- block, and nothing for a username nobody has.
create or replace function public.public_profile(uname text, p_year integer default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  p public.profiles;
  rel text;
  tv text;
  see_trips boolean;
begin
  select * into p from public.profiles where username = lower(ltrim(btrim(coalesce(uname, '')), '@'));
  if p.id is null or public.is_blocked(p.id, me) then return null; end if;
  if me is null and not p.public_page then
    return jsonb_build_object('profile', jsonb_build_object('username', p.username, 'display_name', p.display_name), 'hidden', true);
  end if;
  rel := public.relation_to(p.id, me);
  tv := coalesce(p.visibility ->> 'trips', 'me');
  see_trips := rel = 'self' or tv = 'everyone' or (tv = 'friends' and rel = 'friends');
  return jsonb_build_object(
    'profile', public.profile_for(p, me),
    'hidden', false,
    'year', p_year,
    'years', coalesce((
      select jsonb_agg(y order by y desc) from (
        select distinct extract(year from o.on_date)::integer as y from public.outings o
          where o.user_id = p.id and public.can_see_outing(o.user_id, o.visibility, me)
        union
        select distinct extract(year from t.start_date)::integer from public.shared_trips t
          where t.user_id = p.id and see_trips
      ) ys
    ), '[]'::jsonb),
    'trips', case when not see_trips then '[]'::jsonb else coalesce((
      select jsonb_agg(x.j order by x.start_date desc) from (
        select t.start_date, jsonb_build_object('id', t.trip_id, 'title', t.title, 'start', t.start_date, 'end', t.end_date,
          'rating', t.rating, 'highlight', t.highlight, 'stops', t.stops) as j
        from public.shared_trips t
        where t.user_id = p.id and (p_year is null
          or p_year between extract(year from t.start_date) and extract(year from coalesce(t.end_date, t.start_date)))
        order by t.start_date desc limit 500
      ) x
    ), '[]'::jsonb) end,
    'outings', coalesce((
      select jsonb_agg(x.j order by x.on_date desc) from (
        select o.on_date, jsonb_build_object('id', o.event_id, 'kind', o.kind, 'title', o.title, 'date', o.on_date, 'rating', o.rating,
          'review', o.review, 'links', coalesce((
            select jsonb_agg(public.catalog_entry(c) order by c.kind, c.name)
            from public.outing_links l join public.catalog c on c.id = l.catalog_id
            where l.user_id = o.user_id and l.event_id = o.event_id
          ), '[]'::jsonb)) as j
        from public.outings o
        where o.user_id = p.id and public.can_see_outing(o.user_id, o.visibility, me)
          and (p_year is null or extract(year from o.on_date) = p_year)
        order by o.on_date desc limit 200
      ) x
    ), '[]'::jsonb)
  );
end $$;

revoke all on function public.sync_trips(jsonb) from public, anon;
revoke all on function public.public_profile(text, integer) from public;
grant execute on function public.sync_trips(jsonb) to authenticated;
grant execute on function public.public_profile(text, integer) to anon, authenticated;

-- Tell the API about the table now. Without this it can briefly answer
-- "Could not find the table 'public.orbit_data' in the schema cache".
notify pgrst, 'reload schema';
