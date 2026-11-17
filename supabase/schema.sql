-- Ja-Nee Management schema foundation. Review every policy before production.
-- Never store Discord webhook URLs in these public application tables.
create extension if not exists pgcrypto;
create type public.member_role as enum ('owner','administrator','management','developer','viewer');
create type public.task_priority as enum ('low','medium','high','urgent');
create type public.roadmap_status as enum ('planned','in_progress','completed','on_hold');

create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null, username text, avatar_url text,
 role public.member_role not null default 'viewer', approved boolean not null default false,
 discord_user_id text unique, github_username text, last_active_at timestamptz,
 created_at timestamptz not null default now()
);
create table public.board_columns (
 id uuid primary key default gen_random_uuid(), title text not null,
 color text not null default '#78a35a', position integer not null
);
create table public.tasks (
 id uuid primary key default gen_random_uuid(), title text not null,
 description text not null default '',
 column_id uuid references public.board_columns(id) on delete set null,
 priority public.task_priority not null default 'medium', due_date date,
 position integer not null default 0, created_by uuid references public.profiles(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.task_assignees (
 task_id uuid not null references public.tasks(id) on delete cascade,
 profile_id uuid not null references public.profiles(id) on delete cascade,
 assigned_by uuid references public.profiles(id) on delete set null,
 primary key(task_id,profile_id)
);
create table public.tags (
 id uuid primary key default gen_random_uuid(), name text unique not null,
 color text not null default '#78a35a'
);
create table public.task_tags (
 task_id uuid not null references public.tasks(id) on delete cascade,
 tag_id uuid not null references public.tags(id) on delete cascade,
 primary key(task_id,tag_id)
);
create table public.checklist_items (
 id uuid primary key default gen_random_uuid(),
 task_id uuid not null references public.tasks(id) on delete cascade,
 text text not null, position integer not null default 0,
 completed boolean not null default false,
 completed_by uuid references public.profiles(id) on delete set null,
 completed_at timestamptz
);
create table public.task_comments (
 id uuid primary key default gen_random_uuid(),
 task_id uuid not null references public.tasks(id) on delete cascade,
 author_id uuid not null references public.profiles(id),
 body text not null, created_at timestamptz not null default now()
);
create table public.task_activity (
 id uuid primary key default gen_random_uuid(),
 task_id uuid references public.tasks(id) on delete set null,
 actor_id uuid references public.profiles(id) on delete set null,
 action text not null, before_value jsonb, after_value jsonb,
 created_at timestamptz not null default now()
);
create table public.roadmaps (
 id uuid primary key default gen_random_uuid(), title text not null,
 description text not null default '', category text not null default 'General',
 status public.roadmap_status not null default 'planned',
 priority public.task_priority not null default 'medium',
 progress smallint not null default 0 check(progress between 0 and 100),
 start_date date, target_date date, created_at timestamptz not null default now()
);
create table public.milestones (
 id uuid primary key default gen_random_uuid(),
 roadmap_id uuid not null references public.roadmaps(id) on delete cascade,
 title text not null, due_date date, completed boolean not null default false,
 task_id uuid references public.tasks(id) on delete set null,
 position integer not null default 0
);
create table public.announcements (
 id uuid primary key default gen_random_uuid(), title text not null, body text not null,
 category text not null default 'Team',
 priority public.task_priority not null default 'medium', pinned boolean not null default false,
 expires_at timestamptz, author_id uuid references public.profiles(id) on delete set null,
 created_at timestamptz not null default now()
);
create table public.resources (
 id uuid primary key default gen_random_uuid(), name text not null, url text not null,
 description text not null default '', category text not null default 'Operations',
 icon text not null default 'Link2', position integer not null default 0
);
create table public.dashboard_settings (
 key text primary key, value jsonb not null,
 updated_by uuid references public.profiles(id) on delete set null,
 updated_at timestamptz not null default now()
);
-- The current frontend stores a versioned workspace document in one RLS-protected row.
create table public.workspace_state (
 id text primary key check (id = 'main'), data jsonb not null,
 updated_by uuid references public.profiles(id) on delete set null,
 updated_by_client text, updated_at timestamptz not null default now()
);
create table public.member_presence (
 profile_id uuid primary key references public.profiles(id) on delete cascade,
 status text not null default 'offline' check(status in ('online','away','offline')),
 activity text, last_seen_at timestamptz not null default now()
);
create table public.notifications (
 id uuid primary key default gen_random_uuid(),
 recipient_id uuid not null references public.profiles(id) on delete cascade,
 actor_id uuid references public.profiles(id) on delete set null,
 kind text not null, message text not null, entity_type text, entity_id uuid,
 read_at timestamptz, created_at timestamptz not null default now()
);

create index tasks_column_position_idx on public.tasks(column_id,position);
create index tasks_due_date_idx on public.tasks(due_date);
create index activity_recent_idx on public.task_activity(created_at desc);
create index notifications_unread_idx on public.notifications(recipient_id,read_at) where read_at is null;

create function public.is_approved_member() returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.profiles where id=auth.uid() and approved=true)
$$;
create function public.current_member_role() returns public.member_role language sql stable security definer set search_path=public as $$
 select role from public.profiles where id=auth.uid() and approved=true
$$;
create function public.can_manage_workspace() returns boolean language sql stable security definer set search_path=public as $$
 select coalesce(public.current_member_role() in ('owner','administrator','management'),false)
$$;

alter table public.profiles enable row level security;
alter table public.board_columns enable row level security;
alter table public.tasks enable row level security;
alter table public.task_assignees enable row level security;
alter table public.tags enable row level security;
alter table public.task_tags enable row level security;
alter table public.checklist_items enable row level security;
alter table public.task_comments enable row level security;
alter table public.task_activity enable row level security;
alter table public.roadmaps enable row level security;
alter table public.milestones enable row level security;
alter table public.announcements enable row level security;
alter table public.resources enable row level security;
alter table public.dashboard_settings enable row level security;
alter table public.workspace_state enable row level security;
alter table public.member_presence enable row level security;
alter table public.notifications enable row level security;

create policy "Approved members read profiles" on public.profiles for select to authenticated using(public.is_approved_member());
create policy "Members read their own profile" on public.profiles for select to authenticated using(id=auth.uid());
create policy "Owners update profiles" on public.profiles for update to authenticated using(public.current_member_role()='owner') with check(public.current_member_role()='owner');
create policy "Approved members read board" on public.board_columns for select to authenticated using(public.is_approved_member());
create policy "Managers manage board" on public.board_columns for all to authenticated using(public.can_manage_workspace()) with check(public.can_manage_workspace());
create policy "Approved members read tasks" on public.tasks for select to authenticated using(public.is_approved_member());
create policy "Managers manage tasks" on public.tasks for all to authenticated using(public.can_manage_workspace()) with check(public.can_manage_workspace());
create policy "Approved members read assignments" on public.task_assignees for select to authenticated using(public.is_approved_member());
create policy "Managers manage assignments" on public.task_assignees for all to authenticated using(public.can_manage_workspace()) with check(public.can_manage_workspace());
create policy "Approved members read tags" on public.tags for select to authenticated using(public.is_approved_member());
create policy "Managers manage tags" on public.tags for all to authenticated using(public.can_manage_workspace()) with check(public.can_manage_workspace());
create policy "Approved members read task tags" on public.task_tags for select to authenticated using(public.is_approved_member());
create policy "Managers manage task tags" on public.task_tags for all to authenticated using(public.can_manage_workspace()) with check(public.can_manage_workspace());
create policy "Approved members read checklists" on public.checklist_items for select to authenticated using(public.is_approved_member());
create policy "Managers manage checklists" on public.checklist_items for all to authenticated using(public.can_manage_workspace()) with check(public.can_manage_workspace());
create policy "Approved members read comments" on public.task_comments for select to authenticated using(public.is_approved_member());
create policy "Members create own comments" on public.task_comments for insert to authenticated with check(public.is_approved_member() and author_id=auth.uid());
create policy "Authors or managers delete comments" on public.task_comments for delete to authenticated using(author_id=auth.uid() or public.can_manage_workspace());
create policy "Approved members read activity" on public.task_activity for select to authenticated using(public.is_approved_member());
create policy "Members write own activity" on public.task_activity for insert to authenticated with check(public.is_approved_member() and actor_id=auth.uid());
create policy "Approved members read roadmaps" on public.roadmaps for select to authenticated using(public.is_approved_member());
create policy "Managers manage roadmaps" on public.roadmaps for all to authenticated using(public.can_manage_workspace()) with check(public.can_manage_workspace());
create policy "Approved members read milestones" on public.milestones for select to authenticated using(public.is_approved_member());
create policy "Managers manage milestones" on public.milestones for all to authenticated using(public.can_manage_workspace()) with check(public.can_manage_workspace());
create policy "Approved members read announcements" on public.announcements for select to authenticated using(public.is_approved_member());
create policy "Managers manage announcements" on public.announcements for all to authenticated using(public.can_manage_workspace()) with check(public.can_manage_workspace());
create policy "Approved members read resources" on public.resources for select to authenticated using(public.is_approved_member());
create policy "Managers manage resources" on public.resources for all to authenticated using(public.can_manage_workspace()) with check(public.can_manage_workspace());
create policy "Approved members read settings" on public.dashboard_settings for select to authenticated using(public.is_approved_member());
create policy "Owners manage settings" on public.dashboard_settings for all to authenticated using(public.current_member_role()='owner') with check(public.current_member_role()='owner');
create policy "Approved members read workspace state" on public.workspace_state for select to authenticated using(public.is_approved_member());
create policy "Approved members create workspace state" on public.workspace_state for insert to authenticated with check(public.is_approved_member());
create policy "Approved members update workspace state" on public.workspace_state for update to authenticated using(public.is_approved_member()) with check(public.is_approved_member());
create policy "Approved members read presence" on public.member_presence for select to authenticated using(public.is_approved_member());
create policy "Members manage own presence" on public.member_presence for all to authenticated using(profile_id=auth.uid() and public.is_approved_member()) with check(profile_id=auth.uid() and public.is_approved_member());
create policy "Members read own notifications" on public.notifications for select to authenticated using(recipient_id=auth.uid() and public.is_approved_member());
create policy "Members update own notifications" on public.notifications for update to authenticated using(recipient_id=auth.uid() and public.is_approved_member()) with check(recipient_id=auth.uid() and public.is_approved_member());

grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update on public.workspace_state to authenticated;

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path=public as $$
declare provider text := coalesce(new.raw_app_meta_data->>'provider','');
begin
 insert into public.profiles(id,display_name,username,avatar_url,discord_user_id,github_username)
 values(
  new.id,
  coalesce(nullif(new.raw_user_meta_data->>'user_name',''),nullif(new.raw_user_meta_data->>'preferred_username',''),nullif(new.raw_user_meta_data->>'full_name',''),nullif(new.raw_user_meta_data->>'name',''),nullif(split_part(coalesce(new.email,''),'@',1),''),'Team member'),
  coalesce(nullif(new.raw_user_meta_data->>'user_name',''),nullif(new.raw_user_meta_data->>'preferred_username','')),
  coalesce(new.raw_user_meta_data->>'avatar_url',new.raw_user_meta_data->>'picture'),
  case when provider='discord' then new.raw_user_meta_data->>'provider_id' else null end,
  case when provider='github' then coalesce(new.raw_user_meta_data->>'user_name',new.raw_user_meta_data->>'preferred_username') else null end
 ) on conflict(id) do nothing;
 return new;
end;
$$;
create trigger on_auth_user_created
 after insert on auth.users for each row execute function public.handle_new_user();

do $$
begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='workspace_state') then
  execute 'alter publication supabase_realtime add table public.workspace_state';
 end if;
end $$;

insert into public.board_columns(title,color,position)
select s.title,s.color,s.position from (values
 ('Backlog','#7d8792',0),('To do','#88954a',1),('In progress','#75a252',2),('Under review','#a78753',3),('Completed','#4e956b',4)
) as s(title,color,position) where not exists(select 1 from public.board_columns);

-- Bootstrap: after the first OAuth sign-in, copy the user's UUID from Authentication → Users,
-- then set approved=true and role='owner' for that UUID in a trusted SQL editor session.
