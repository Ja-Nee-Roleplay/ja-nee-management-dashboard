-- Private announcement images and public Discord notification thumbnails. Run once for an existing project.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'announcement-images',
  'announcement-images',
  false,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Approved members upload announcement images" on storage.objects;
create policy "Approved members upload announcement images"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'announcement-images'
  and public.is_approved_member()
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Approved members read announcement images" on storage.objects;
create policy "Approved members read announcement images"
on storage.objects for select to authenticated
using (bucket_id = 'announcement-images' and public.is_approved_member());

drop policy if exists "Approved members delete announcement images" on storage.objects;
create policy "Approved members delete announcement images"
on storage.objects for delete to authenticated
using (bucket_id = 'announcement-images' and public.is_approved_member());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'discord-notification-images',
  'discord-notification-images',
  true,
  5242880,
  array['image/webp']
)
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Approved members upload Discord notification images" on storage.objects;
create policy "Approved members upload Discord notification images"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'discord-notification-images'
  and public.is_approved_member()
  and (storage.foldername(name))[1] = 'workspace'
);

drop policy if exists "Approved members read Discord notification images" on storage.objects;
create policy "Approved members read Discord notification images"
on storage.objects for select to authenticated
using (
  bucket_id = 'discord-notification-images'
  and public.is_approved_member()
  and (storage.foldername(name))[1] = 'workspace'
);

drop policy if exists "Approved members delete Discord notification images" on storage.objects;
create policy "Approved members delete Discord notification images"
on storage.objects for delete to authenticated
using (
  bucket_id = 'discord-notification-images'
  and public.is_approved_member()
  and (storage.foldername(name))[1] = 'workspace'
);
