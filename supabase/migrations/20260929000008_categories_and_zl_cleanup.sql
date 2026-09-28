-- =====================================================================
-- 原岩攀岩館 會員與櫃檯系統
-- 第 8 部分：品項分類改成設計稿的 6 類；刪除中壢店（原 A19）品項
-- 老闆 2026-09-29 確認：
--   - A19 已結束營業，原本照 A19 價格掛在中壢店的品項直接刪除，等中壢開幕前再設定
--   - 單純入場（不攀爬）歸在「裝備租借」
-- 這個檔案只整理「已經存在」的資料；全新建立的資料庫由 seed 直接建立正確資料，這裡不會有影響。
-- =====================================================================

-- 分類小色點（設計稿的分類標題與品項管理會用到）
alter table public.product_categories
  add column dot_color text check (dot_color is null or dot_color ~ '^#[0-9A-Fa-f]{6}$');
comment on column public.product_categories.dot_color is '分類小色點顏色（設計稿）';

-- 1. 設計稿的 6 個分類
insert into public.product_categories (name, bg_color, text_color, dot_color, sort_order, is_active) values
  ('平日入場',     '#F7ECC8', '#5A4106', '#C99A1E', 1, true),
  ('假日入場',     '#DCEBE4', '#173F32', '#2F6B57', 2, true),
  ('兒童',         '#F5DDE6', '#6B1F3D', '#B94A77', 3, true),
  ('套票・年月票', '#F6DDD2', '#6E2A12', '#B24A22', 4, true),
  ('新手與活動',   '#DCE4F0', '#1F3A63', '#3B62A0', 5, true),
  ('裝備租借',     '#E9E5DD', '#2F2B25', '#6B655C', 6, true)
on conflict (name) do update set
  bg_color = excluded.bg_color, text_color = excluded.text_color, dot_color = excluded.dot_color,
  sort_order = excluded.sort_order, is_active = true;

-- 2. 把現有品項移到新分類
update public.products p set category_id = (select id from public.product_categories where name =
  case
    when old.name in ('成人票', '學生票') and p.usage_rule = 'weekend' then '假日入場'
    when old.name in ('成人票', '學生票') then '平日入場'
    when old.name = '兒童幼兒票' then '兒童'
    when old.name = '票券' then '套票・年月票'
    when old.name in ('團體課程', '一對一課程') then '新手與活動'
    when old.name in ('租借', '陪同入場') then '裝備租借'
  end)
from public.product_categories old
where old.id = p.category_id
  and old.name in ('成人票', '學生票', '兒童幼兒票', '票券', '團體課程', '一對一課程', '租借', '陪同入場');

-- 舊分類停用（分類不能刪除）
update public.product_categories set is_active = false, sort_order = 100 + sort_order
where name in ('成人票', '學生票', '兒童幼兒票', '票券', '團體課程', '一對一課程', '租借', '陪同入場')
  and is_active;

-- 3. 中壢店（原 A19）品項
do $$
declare v_zl uuid := (select id from public.branches where code = 'ZL');
begin
  if v_zl is null then return; end if;

  -- 只在中壢販售的品項
  create temp table zl_only on commit drop as
  select p.id from public.products p
  where not p.all_branches
    and exists (select 1 from public.product_branches pb where pb.product_id = p.id and pb.branch_id = v_zl)
    and not exists (select 1 from public.product_branches pb where pb.product_id = p.id and pb.branch_id <> v_zl);

  -- 多館共用的課程：拿掉中壢
  delete from public.product_branches where branch_id = v_zl;

  -- 只在中壢販售、而且從來沒有賣出過的品項：直接刪除（品項平常不能刪除，這裡是老闆確認的一次性清理）
  alter table public.products disable trigger forbid_delete;
  delete from public.products p
  where p.id in (select id from zl_only)
    and not exists (select 1 from public.order_items oi where oi.product_id = p.id)
    and not exists (select 1 from public.member_plans mp where mp.product_id = p.id);
  alter table public.products enable trigger forbid_delete;

  -- 萬一有賣出過（不應該發生），改成下架保留紀錄
  update public.products set status = 'off_sale' where id in (select id from zl_only);
end $$;
