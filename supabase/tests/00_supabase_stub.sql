-- 本機測試用：模擬 Supabase 的 auth / storage 環境（正式 Supabase 不需要執行）
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema extensions; create schema auth; create schema storage;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, phone text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth, storage, extensions to anon, authenticated;
grant execute on function auth.uid() to authenticated, anon;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
grant all on storage.objects to authenticated;
