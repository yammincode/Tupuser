-- =====================================================================
-- 品項初始資料（由 supabase/seed/tools/gen_products.py 依價目表產生，請勿手動修改）
-- 價格來源：老闆提供的入場價目表與課程價目表（課程採 2024/01 現行價格）
-- 分類依 design/ 設計稿 6 類；中壢店（原 A19）不建立品項
-- 只會在「還沒有任何品項（系統用的方案轉讓費不算）」時執行；已經有品項就整段跳過，不會重複建立。
-- =====================================================================
do $seed$
begin
  if exists (select 1 from public.products where to_jsonb(products) ->> 'system_key' is null) then
    raise notice '已經有品項資料，跳過';
    return;
  end if;

  insert into public.product_categories (name, bg_color, text_color, dot_color, sort_order) values
    ('平日入場', '#F7ECC8', '#5A4106', '#C99A1E', 1),
    ('假日入場', '#DCEBE4', '#173F32', '#2F6B57', 2),
    ('兒童', '#F5DDE6', '#6B1F3D', '#B94A77', 3),
    ('套票・年月票', '#F6DDD2', '#6E2A12', '#B24A22', 4),
    ('新手與活動', '#DCE4F0', '#1F3A63', '#3B62A0', 5),
    ('裝備租借', '#E9E5DD', '#2F2B25', '#6B655C', 6)
  on conflict (name) do nothing;

  create temp table seed_products (
    sort_order int, category text, name text, price int, content_type public.content_type,
    quantity int, usage_rule public.usage_rule, slot_start time, slot_end time, branch_codes text[]
  ) on commit drop;
  insert into seed_products values
    (10, '平日入場', '平日 成人全天', 500, 'single', 1, 'weekday', null, null, array['MD']),
    (20, '平日入場', '平日 成人白天', 350, 'single', 1, 'weekday', '12:00', '18:00', array['MD']),
    (30, '平日入場', '平日 成人晚上', 450, 'single', 1, 'weekday', '17:00', '23:00', array['MD']),
    (40, '平日入場', '平日 成人星光', 320, 'single', 1, 'weekday', '20:30', '23:00', array['MD']),
    (50, '平日入場', '平日 學生全天', 350, 'single', 1, 'weekday', null, null, array['MD']),
    (60, '平日入場', '平日 學生白天', 280, 'single', 1, 'weekday', '12:00', '18:00', array['MD']),
    (70, '平日入場', '平日 學生晚上', 300, 'single', 1, 'weekday', '17:00', '23:00', array['MD']),
    (80, '平日入場', '平日 學生星光', 250, 'single', 1, 'weekday', '20:30', '23:00', array['MD']),
    (90, '兒童', '平日 兒童全天', 250, 'single', 1, 'weekday', null, null, array['MD']),
    (100, '兒童', '平日 幼兒全天', 200, 'single', 1, 'weekday', null, null, array['MD']),
    (110, '平日入場', '平日 成人全天', 450, 'single', 1, 'weekday', null, null, array['WH']),
    (120, '平日入場', '平日 成人白天', 350, 'single', 1, 'weekday', '10:00', '18:00', array['WH']),
    (130, '平日入場', '平日 成人晚上', 420, 'single', 1, 'weekday', '17:00', '23:00', array['WH']),
    (140, '平日入場', '平日 成人星光', 320, 'single', 1, 'weekday', '20:30', '23:00', array['WH']),
    (150, '平日入場', '平日 學生全天', 350, 'single', 1, 'weekday', null, null, array['WH']),
    (160, '平日入場', '平日 學生白天', 280, 'single', 1, 'weekday', '10:00', '18:00', array['WH']),
    (170, '平日入場', '平日 學生晚上', 300, 'single', 1, 'weekday', '17:00', '23:00', array['WH']),
    (180, '平日入場', '平日 學生星光', 250, 'single', 1, 'weekday', '20:30', '23:00', array['WH']),
    (190, '兒童', '平日 兒童早鳥', 200, 'single', 1, 'weekday', '10:00', '13:00', array['WH']),
    (200, '兒童', '平日 兒童全天', 250, 'single', 1, 'weekday', null, null, array['WH']),
    (210, '兒童', '平日 幼兒全天', 200, 'single', 1, 'weekday', null, null, array['WH']),
    (220, '平日入場', '平日 成人全天', 450, 'single', 1, 'weekday', null, null, array['NG']),
    (230, '平日入場', '平日 成人白天', 320, 'single', 1, 'weekday', '12:00', '18:00', array['NG']),
    (240, '平日入場', '平日 成人晚上', 400, 'single', 1, 'weekday', '17:00', '23:00', array['NG']),
    (250, '平日入場', '平日 成人星光', 300, 'single', 1, 'weekday', '20:30', '23:00', array['NG']),
    (260, '平日入場', '平日 學生全天', 350, 'single', 1, 'weekday', null, null, array['NG']),
    (270, '平日入場', '平日 學生白天', 250, 'single', 1, 'weekday', '12:00', '18:00', array['NG']),
    (280, '平日入場', '平日 學生晚上', 300, 'single', 1, 'weekday', '17:00', '23:00', array['NG']),
    (290, '平日入場', '平日 學生星光', 250, 'single', 1, 'weekday', '20:30', '23:00', array['NG']),
    (300, '兒童', '平日 兒童全天', 250, 'single', 1, 'weekday', null, null, array['NG']),
    (310, '兒童', '平日 幼兒全天', 200, 'single', 1, 'weekday', null, null, array['NG']),
    (320, '平日入場', '平日 成人全天', 500, 'single', 1, 'weekday', null, null, array['ZH']),
    (330, '平日入場', '平日 成人白天', 350, 'single', 1, 'weekday', '12:00', '18:00', array['ZH']),
    (340, '平日入場', '平日 成人晚上', 450, 'single', 1, 'weekday', '17:00', '23:00', array['ZH']),
    (350, '平日入場', '平日 成人星光', 320, 'single', 1, 'weekday', '20:30', '23:00', array['ZH']),
    (360, '平日入場', '平日 學生全天', 400, 'single', 1, 'weekday', null, null, array['ZH']),
    (370, '平日入場', '平日 學生白天', 250, 'single', 1, 'weekday', '12:00', '18:00', array['ZH']),
    (380, '平日入場', '平日 學生晚上', 320, 'single', 1, 'weekday', '17:00', '23:00', array['ZH']),
    (390, '平日入場', '平日 學生星光', 250, 'single', 1, 'weekday', '20:30', '23:00', array['ZH']),
    (400, '兒童', '平日 兒童全天', 250, 'single', 1, 'weekday', null, null, array['ZH']),
    (410, '兒童', '平日 幼兒全天', 200, 'single', 1, 'weekday', null, null, array['ZH']),
    (420, '假日入場', '假日 成人全天', 550, 'single', 1, 'weekend', null, null, array['MD']),
    (430, '假日入場', '假日 成人星光', 320, 'single', 1, 'weekend', '19:30', '22:00', array['MD']),
    (440, '假日入場', '假日 學生全天', 350, 'single', 1, 'weekend', null, null, array['MD']),
    (450, '假日入場', '假日 學生星光', 250, 'single', 1, 'weekend', '19:30', '22:00', array['MD']),
    (460, '兒童', '假日 兒童全天', 250, 'single', 1, 'weekend', null, null, array['MD']),
    (470, '兒童', '假日 幼兒全天', 200, 'single', 1, 'weekend', null, null, array['MD']),
    (480, '假日入場', '假日 成人全天', 500, 'single', 1, 'weekend', null, null, array['WH']),
    (490, '假日入場', '假日 成人星光', 320, 'single', 1, 'weekend', '18:30', '21:00', array['WH']),
    (500, '假日入場', '假日 學生全天', 350, 'single', 1, 'weekend', null, null, array['WH']),
    (510, '假日入場', '假日 學生星光', 250, 'single', 1, 'weekend', '18:30', '21:00', array['WH']),
    (520, '兒童', '假日 兒童全天', 250, 'single', 1, 'weekend', null, null, array['WH']),
    (530, '兒童', '假日 幼兒全天', 200, 'single', 1, 'weekend', null, null, array['WH']),
    (540, '假日入場', '假日 成人全天', 450, 'single', 1, 'weekend', null, null, array['NG']),
    (550, '假日入場', '假日 成人星光', 300, 'single', 1, 'weekend', '18:30', '21:00', array['NG']),
    (560, '假日入場', '假日 學生全天', 350, 'single', 1, 'weekend', null, null, array['NG']),
    (570, '假日入場', '假日 學生星光', 250, 'single', 1, 'weekend', '18:30', '21:00', array['NG']),
    (580, '兒童', '假日 兒童全天', 250, 'single', 1, 'weekend', null, null, array['NG']),
    (590, '兒童', '假日 幼兒全天', 200, 'single', 1, 'weekend', null, null, array['NG']),
    (600, '假日入場', '假日 成人全天', 550, 'single', 1, 'weekend', null, null, array['ZH']),
    (610, '假日入場', '假日 成人星光', 320, 'single', 1, 'weekend', '19:00', '22:00', array['ZH']),
    (620, '假日入場', '假日 學生全天', 400, 'single', 1, 'weekend', null, null, array['ZH']),
    (630, '假日入場', '假日 學生星光', 250, 'single', 1, 'weekend', '19:00', '22:00', array['ZH']),
    (640, '兒童', '假日 兒童全天', 250, 'single', 1, 'weekend', null, null, array['ZH']),
    (650, '兒童', '假日 幼兒全天', 200, 'single', 1, 'weekend', null, null, array['ZH']),
    (660, '平日入場', '平日 成人全天', 500, 'single', 1, 'weekday', null, null, array['XD']),
    (670, '平日入場', '平日 成人三小時', 400, 'single', 1, 'weekday', null, null, array['XD']),
    (680, '平日入場', '平日 成人星光', 300, 'single', 1, 'weekday', '20:30', '23:00', array['XD']),
    (690, '平日入場', '平日 學生全天', 400, 'single', 1, 'weekday', null, null, array['XD']),
    (700, '平日入場', '平日 學生三小時', 300, 'single', 1, 'weekday', null, null, array['XD']),
    (710, '平日入場', '平日 學生星光', 250, 'single', 1, 'weekday', '20:30', '23:00', array['XD']),
    (720, '兒童', '平日 兒童全天', 250, 'single', 1, 'weekday', null, null, array['XD']),
    (730, '假日入場', '假日 成人全天', 550, 'single', 1, 'weekend', null, null, array['XD']),
    (740, '假日入場', '假日 成人三小時', 400, 'single', 1, 'weekend', null, null, array['XD']),
    (750, '假日入場', '假日 成人星光', 300, 'single', 1, 'weekend', '19:00', '22:00', array['XD']),
    (760, '假日入場', '假日 學生全天', 400, 'single', 1, 'weekend', null, null, array['XD']),
    (770, '假日入場', '假日 學生三小時', 300, 'single', 1, 'weekend', null, null, array['XD']),
    (780, '假日入場', '假日 學生星光', 250, 'single', 1, 'weekend', '19:00', '22:00', array['XD']),
    (790, '兒童', '假日 兒童兩小時（含裝備）', 500, 'single', 1, 'weekend', null, null, array['XD']),
    (800, '兒童', '假日 兒童三小時（含裝備）', 600, 'single', 1, 'weekend', null, null, array['XD']),
    (810, '裝備租借', '單純入場（不攀爬）', 100, 'single', 1, 'any', null, null, array['MD']),
    (820, '裝備租借', '單純入場（不攀爬）', 100, 'single', 1, 'any', null, null, array['WH']),
    (830, '裝備租借', '單純入場（不攀爬）', 100, 'single', 1, 'any', null, null, array['NG']),
    (840, '裝備租借', '單純入場（不攀爬）', 100, 'single', 1, 'any', null, null, array['ZH']),
    (850, '裝備租借', '單純入場（不攀爬）', 100, 'single', 1, 'any', null, null, array['XD']),
    (860, '新手與活動', '幼兒課（6堂）', 2500, 'course', 6, 'any', null, null, array['WH','NG','MD']),
    (870, '新手與活動', '幼兒課（6堂）', 3000, 'course', 6, 'any', null, null, array['ZH']),
    (880, '新手與活動', '幼兒課 單堂試上', 500, 'course', 1, 'any', null, null, array['WH','NG','MD']),
    (890, '新手與活動', '幼兒課 單堂試上', 600, 'course', 1, 'any', null, null, array['ZH']),
    (900, '新手與活動', '兒童課（6堂）', 3600, 'course', 6, 'any', null, null, array['WH','NG','MD']),
    (910, '新手與活動', '兒童課（6堂）', 4000, 'course', 6, 'any', null, null, array['ZH']),
    (920, '新手與活動', '兒童課（6堂）', 4200, 'course', 6, 'any', null, null, array['XD']),
    (930, '新手與活動', '兒童課 單堂試上', 750, 'course', 1, 'any', null, null, array['WH','NG','MD']),
    (940, '新手與活動', '兒童課 單堂試上', 800, 'course', 1, 'any', null, null, array['ZH','XD']),
    (950, '新手與活動', '青少年課（6堂）', 4200, 'course', 6, 'any', null, null, array['WH','MD']),
    (960, '新手與活動', '青少年課（6堂）', 4500, 'course', 6, 'any', null, null, array['ZH','XD']),
    (970, '新手與活動', '青少年課 單堂試上', 900, 'course', 1, 'any', null, null, array['WH','MD']),
    (980, '新手與活動', '青少年訓練課（8堂）', 6000, 'course', 8, 'any', null, null, array['ZH','XD']),
    (990, '新手與活動', '成人抱石課 新生（4堂）', 4500, 'course', 4, 'any', null, null, array['WH','NG','MD']),
    (1000, '新手與活動', '成人抱石課 舊生（4堂）', 4200, 'course', 4, 'any', null, null, array['WH','NG','MD']),
    (1010, '新手與活動', '成人技巧課（4堂）', 5000, 'course', 4, 'any', null, null, array['ZH','XD']),
    (1020, '新手與活動', '成人初岩課（5堂）', 5500, 'course', 5, 'any', null, null, array['ZH','XD']),
    (1030, '新手與活動', '成人先鋒課（6堂）', 7500, 'course', 6, 'any', null, null, array['ZH','XD']),
    (1040, '新手與活動', '親子抱石課（4堂，每人）', 3900, 'course', 4, 'any', null, null, array['WH','NG','MD','XD']),
    (1050, '新手與活動', '親子課（4堂，每人）', 4500, 'course', 4, 'any', null, null, array['ZH']),
    (1060, '新手與活動', '系統轉換課', 2000, 'course', 1, 'any', null, null, array['ZH']),
    (1070, '新手與活動', '原岩攀岩隊（8堂）', 4000, 'course', 8, 'any', null, null, null),
    (1080, '新手與活動', '特殊生一對一 兒童／幼兒（8堂）', 4800, 'course', 8, 'any', null, null, null),
    (1090, '新手與活動', '一對一 兒童／青少年（4堂）', 5000, 'course', 4, 'any', null, null, null),
    (1100, '新手與活動', '一對一 成人（4堂）', 6000, 'course', 4, 'any', null, null, null),
    (1110, '新手與活動', '一對一 初岩確保（5堂）', 10000, 'course', 5, 'any', null, null, array['ZH','XD']),
    (1120, '新手與活動', '一對一 先鋒確保（6堂）', 12000, 'course', 6, 'any', null, null, array['ZH','XD']);

  with ins as (
    insert into public.products (name, category_id, price, content_type, quantity, usage_rule,
                                 slot_start, slot_end, all_branches, sort_order)
    select sp.name, pc.id, sp.price, sp.content_type, sp.quantity, sp.usage_rule,
           sp.slot_start, sp.slot_end, sp.branch_codes is null, sp.sort_order
    from seed_products sp join public.product_categories pc on pc.name = sp.category
    returning id, sort_order
  )
  insert into public.product_branches (product_id, branch_id)
  select ins.id, b.id
  from ins
  join seed_products sp on sp.sort_order = ins.sort_order
  join public.branches b on b.code = any (sp.branch_codes);
end $seed$;

-- 檢查結果：每間分館可以賣的品項數
select b.code as 代碼, b.name as 分館, count(p.id) as 品項數
from public.branches b
left join public.products p
  on p.all_branches or exists (select 1 from public.product_branches pb
                               where pb.product_id = p.id and pb.branch_id = b.id)
group by b.code, b.name, b.sort_order
order by b.sort_order;

