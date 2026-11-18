-- Weekly cleanup for the dashboard activity feed only. Run once for an existing project.
-- Supabase Cron uses pg_cron; 22:00 UTC Sunday is 00:00 Monday in Johannesburg.
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

create or replace function public.clear_weekly_dashboard_activity()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  johannesburg_now timestamp without time zone := now() at time zone 'Africa/Johannesburg';
  week_start date;
  week_key text;
begin
  week_start := johannesburg_now::date - (extract(isodow from johannesburg_now)::integer - 1);
  week_key := to_char(week_start, 'YYYY-MM-DD');

  update public.workspace_state
  set data = jsonb_set(
        jsonb_set(coalesce(data, '{}'::jsonb), '{events}', '[]'::jsonb, true),
        '{activityLogClearedWeek}', to_jsonb(week_key), true
      ),
      updated_by = null,
      updated_by_client = 'weekly-activity-cleanup',
      updated_at = now()
  where id = 'main'
    and coalesce(data->>'activityLogClearedWeek', '') <> week_key;
end;
$$;

revoke all on function public.clear_weekly_dashboard_activity() from public, anon, authenticated;

do $$
declare
  existing_job record;
begin
  for existing_job in select jobid from cron.job where jobname = 'ja-nee-weekly-dashboard-activity-cleanup' loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
  perform cron.schedule(
    'ja-nee-weekly-dashboard-activity-cleanup',
    '0 22 * * 0',
    'select public.clear_weekly_dashboard_activity();'
  );
end;
$$;
