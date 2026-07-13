insert into storage.buckets (id, name, public)
values ('user-files', 'user-files', false)
on conflict (id) do update set public = false;

drop policy if exists user_files_objects_select_own on storage.objects;
create policy user_files_objects_select_own
on storage.objects for select
using (
  bucket_id = 'user-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists user_files_objects_insert_own on storage.objects;
create policy user_files_objects_insert_own
on storage.objects for insert
with check (
  bucket_id = 'user-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists user_files_objects_update_own on storage.objects;
create policy user_files_objects_update_own
on storage.objects for update
using (
  bucket_id = 'user-files'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'user-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists user_files_objects_delete_own on storage.objects;
create policy user_files_objects_delete_own
on storage.objects for delete
using (
  bucket_id = 'user-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);
