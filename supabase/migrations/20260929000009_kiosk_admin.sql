-- =====================================================================
-- 原岩攀岩館 會員與櫃檯系統
-- 第 9 部分：入場機與總部後台需要的功能
--   1. kiosk_info()：入場機開機時取得自己的分館名稱與音量
-- =====================================================================

-- 1. 入場機資訊（入場機帳號本身不能讀 devices／branches 以外的資料，所以用函式提供）
create or replace function public.kiosk_info() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare d public.devices; b public.branches;
begin
  d := app.device();
  if d.id is null then
    raise exception '這個帳號不是入場機帳號，或入場機已被停用' using errcode = '42501';
  end if;
  select * into b from public.branches where id = d.branch_id;
  return jsonb_build_object(
    'device', jsonb_build_object('id', d.id, 'name', d.name),
    'branch', jsonb_build_object('id', b.id, 'name', b.name, 'brand_label', b.brand_label,
                                 'color', b.color, 'kiosk_volume', b.kiosk_volume));
end $$;

revoke all on function public.kiosk_info() from public, anon;
grant execute on function public.kiosk_info() to authenticated;
