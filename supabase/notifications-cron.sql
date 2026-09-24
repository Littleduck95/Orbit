-- Runs Orbit's notify function once an hour. Run this in the Supabase SQL
-- Editor after the function is deployed, with CRON_SECRET below replaced by
-- the same value you gave the function as its CRON_SECRET secret. Safe to
-- run again: it replaces the job rather than adding a second one.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'orbit-notify';

select cron.schedule(
  'orbit-notify',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'https://zteqzxfqodbhbrtzrmdf.supabase.co/functions/v1/notify',
    headers := jsonb_build_object('content-type', 'application/json', 'x-orbit-cron', 'CRON_SECRET'),
    body := '{"action": "run"}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- To check it later: the last few runs, newest first.
-- select status, return_message, start_time from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'orbit-notify')
--   order by start_time desc limit 5;
