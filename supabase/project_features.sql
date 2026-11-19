-- Additive project, member preference, and leave-of-absence support.
-- Run after supabase/schema.sql in the Supabase SQL Editor.

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  message text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leave_requests_valid_range check (end_date >= start_date),
  constraint leave_requests_message_size check (message is null or char_length(message) <= 2000),
  constraint leave_requests_review_note_size check (review_note is null or char_length(review_note) <= 1000)
);

create index if not exists leave_requests_dates_idx on public.leave_requests(start_date, end_date);
create index if not exists leave_requests_member_idx on public.leave_requests(profile_id, created_at desc);

alter table public.leave_requests enable row level security;
drop policy if exists "Approved members read leave requests" on public.leave_requests;
drop policy if exists "Members submit own leave requests" on public.leave_requests;
drop policy if exists "Members update own pending leave requests" on public.leave_requests;
drop policy if exists "Members cancel own pending leave requests" on public.leave_requests;
create policy "Approved members read leave requests" on public.leave_requests for select to authenticated using (public.is_approved_member());
create policy "Members submit own leave requests" on public.leave_requests for insert to authenticated with check (public.is_approved_member() and profile_id = auth.uid() and status = 'pending' and reviewed_by is null and reviewed_at is null);
create policy "Members update own pending leave requests" on public.leave_requests for update to authenticated using (public.is_approved_member() and profile_id = auth.uid() and status = 'pending') with check (public.is_approved_member() and profile_id = auth.uid() and status = 'pending' and reviewed_by is null and reviewed_at is null);
create policy "Members cancel own pending leave requests" on public.leave_requests for delete to authenticated using (public.is_approved_member() and profile_id = auth.uid() and status = 'pending');
grant select, insert, delete on public.leave_requests to authenticated;
grant update (start_date, end_date, message) on public.leave_requests to authenticated;

create table if not exists public.member_preferences (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  project_source text not null default 'dashboard' check (project_source in ('dashboard', 'github', 'both')),
  github_project_id text,
  github_project_title text,
  github_project_url text,
  updated_at timestamptz not null default now(),
  constraint member_preferences_project_id_size check (github_project_id is null or char_length(github_project_id) <= 200),
  constraint member_preferences_project_title_size check (github_project_title is null or char_length(github_project_title) <= 200)
);

alter table public.member_preferences enable row level security;
drop policy if exists "Members read own preferences" on public.member_preferences;
drop policy if exists "Members create own preferences" on public.member_preferences;
drop policy if exists "Members update own preferences" on public.member_preferences;
create policy "Members read own preferences" on public.member_preferences for select to authenticated using (public.is_approved_member() and profile_id = auth.uid());
create policy "Members create own preferences" on public.member_preferences for insert to authenticated with check (public.is_approved_member() and profile_id = auth.uid());
create policy "Members update own preferences" on public.member_preferences for update to authenticated using (public.is_approved_member() and profile_id = auth.uid()) with check (public.is_approved_member() and profile_id = auth.uid());
grant select, insert, update on public.member_preferences to authenticated;

create or replace function public.set_project_feature_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists leave_requests_updated_at on public.leave_requests;
create trigger leave_requests_updated_at before update on public.leave_requests for each row execute function public.set_project_feature_updated_at();
drop trigger if exists member_preferences_updated_at on public.member_preferences;
create trigger member_preferences_updated_at before update on public.member_preferences for each row execute function public.set_project_feature_updated_at();

create or replace function public.notify_leave_request_changes() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  member_name text;
  message_text text;
begin
  select display_name into member_name from public.profiles where id = new.profile_id;
  if tg_op = 'INSERT' then
    message_text := coalesce(member_name, 'A team member') || ' requested leave from ' || new.start_date::text || ' to ' || new.end_date::text || '.';
    insert into public.notifications(recipient_id, actor_id, kind, message, entity_type, entity_id)
      select id, new.profile_id, 'loa_submitted', message_text, 'leave_request', new.id
      from public.profiles
      where approved and role in ('owner', 'administrator', 'management') and id <> new.profile_id;
    return new;
  end if;
  if old.status is distinct from new.status and new.status in ('approved', 'declined') then
    message_text := 'Your leave request for ' || new.start_date::text || ' to ' || new.end_date::text || ' was ' || new.status || '.';
    if nullif(trim(new.review_note), '') is not null then message_text := message_text || ' ' || trim(new.review_note); end if;
    insert into public.notifications(recipient_id, actor_id, kind, message, entity_type, entity_id)
      values (new.profile_id, new.reviewed_by, 'loa_' || new.status, message_text, 'leave_request', new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists leave_request_notifications on public.leave_requests;
create trigger leave_request_notifications after insert or update of status on public.leave_requests for each row execute function public.notify_leave_request_changes();

create or replace function public.review_leave_request(p_request_id uuid, p_status text, p_note text default null)
returns public.leave_requests
language plpgsql security definer set search_path = public as $$
declare
  reviewed public.leave_requests;
begin
  if not public.is_approved_member() or not public.can_manage_workspace() then
    raise exception 'Only approved managers can review leave requests' using errcode = '42501';
  end if;
  if p_status not in ('approved', 'declined') then
    raise exception 'Review status must be approved or declined' using errcode = '22023';
  end if;
  update public.leave_requests
     set status = p_status,
         review_note = nullif(left(trim(coalesce(p_note, '')), 1000), ''),
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where id = p_request_id and status = 'pending'
   returning * into reviewed;
  if not found then raise exception 'Pending leave request not found' using errcode = 'P0002'; end if;
  return reviewed;
end;
$$;
revoke all on function public.review_leave_request(uuid, text, text) from public;
grant execute on function public.review_leave_request(uuid, text, text) to authenticated;

grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

do $$
begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='leave_requests') then
    execute 'alter publication supabase_realtime add table public.leave_requests';
  end if;
end $$;
