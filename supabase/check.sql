-- Orbit setup check. Paste into the Supabase SQL Editor and Run. It only
-- reads: nothing is created, changed or deleted. Every line should say OK;
-- anything Missing means supabase/schema.sql needs running again (the whole
-- file; it is safe to run more than once).
select item, case when ok then 'OK' else 'MISSING - run schema.sql again' end as status
from (values
  (1,  'Saved data table',                     to_regclass('public.orbit_data') is not null),
  (2,  'Saved data is private to each person', coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.orbit_data')), false)
                                                and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'orbit_data') = 4),
  (3,  'Profiles table (usernames)',           to_regclass('public.profiles') is not null),
  (4,  'Profiles are private to each person',  coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.profiles')), false)
                                                and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'profiles') = 3),
  (5,  '13 and older check',                   exists (select 1 from pg_trigger where tgname = 'profiles_check')),
  (6,  'Username check on sign-up form',       to_regprocedure('public.username_available(text)') is not null),
  (7,  'Profile made when someone signs up',   exists (select 1 from pg_trigger where tgname = 'on_auth_user_created')),
  (8,  'Delete my account',                    to_regprocedure('public.delete_my_account()') is not null),
  (9,  'Part 2: profile details and settings', exists (select 1 from information_schema.columns
                                                  where table_schema = 'public' and table_name = 'profiles' and column_name = 'visibility')),
  (10, 'Part 2: friendships',                  to_regclass('public.friendships') is not null
                                                and coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.friendships')), false)),
  (11, 'Part 2: blocking',                     to_regclass('public.blocks') is not null
                                                and coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.blocks')), false)),
  (12, 'Part 2: search people',                to_regprocedure('public.search_profiles(text)') is not null),
  (13, 'Part 2: open a friend code',           to_regprocedure('public.get_profile(text)') is not null),
  (14, 'Part 2: friend requests',              to_regprocedure('public.send_friend_request(uuid)') is not null
                                                and to_regprocedure('public.respond_friend_request(uuid, boolean)') is not null
                                                and to_regprocedure('public.remove_friend(uuid)') is not null
                                                and to_regprocedure('public.my_friends()') is not null),
  (15, 'Part 2: block and unblock',            to_regprocedure('public.block_user(uuid)') is not null
                                                and to_regprocedure('public.unblock_user(uuid)') is not null
                                                and to_regprocedure('public.my_blocks()') is not null)
) as t(n, item, ok)
order by n;
