-- =====================================================================
-- 原岩攀岩館 會員與櫃檯系統
-- 第 4 部分：檔案空間（大頭照、同意書簽名圖）
-- 兩個空間都是「私有」，沒有公開網址；只能由有權限的人取得限時連結。
--
-- 檔案路徑規則：
--   avatars/<會員 id>/<檔名>      大頭照
--   signatures/<會員 id>/<檔名>   同意書簽名圖
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars',    'avatars',    false, 2097152, array['image/jpeg', 'image/png', 'image/webp']),
  ('signatures', 'signatures', false, 1048576, array['image/png', 'image/svg+xml'])
on conflict (id) do nothing;

-- 大頭照：員工可看與上傳；會員可看與上傳自己的；入場機可看（顯示在成功畫面）
create policy avatars_read on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (
    app.is_staff()
    or (storage.foldername(name))[1] = app.member_id()::text
    or (app.device()).id is not null
  ));
create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (
    app.is_staff() or (storage.foldername(name))[1] = app.member_id()::text
  ));
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (
    app.is_staff() or (storage.foldername(name))[1] = app.member_id()::text
  ));

-- 簽名圖：只能新增、不能覆蓋或刪除（法律證據）
create policy signatures_read on storage.objects for select to authenticated
  using (bucket_id = 'signatures' and (
    app.is_staff() or (storage.foldername(name))[1] = app.member_id()::text
  ));
create policy signatures_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'signatures' and (
    app.is_staff() or (storage.foldername(name))[1] = app.member_id()::text
  ));
