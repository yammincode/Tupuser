-- =====================================================================
-- 品項初始資料（由 supabase/seed/tools/gen_products.py 依價目表產生，請勿手動修改）
-- 價格來源：老闆提供的入場價目表與課程價目表（課程採 2024/01 現行價格）
-- 只會在「還沒有任何品項」時執行；已經有品項就整段跳過，不會重複建立。
-- =====================================================================
do $seed$
begin
  if exists (select 1 from public.products) then
    raise notice '已經有品項資料，跳過';
    return;
  end if;

  insert into public.product_categories (name, bg_color, text_color, sort_order) values
    ('成人票', '#1F6F5C', '#FFFFFF', 1),
    ('學生票', '#2563EB', '#FFFFFF', 2),
    ('兒童幼兒票', '#F59E0B', '#111827', 3),
    ('陪同入場', '#6B7280', '#FFFFFF', 4),
    ('團體課程', '#7C3AED', '#FFFFFF', 5),
    ('一對一課程', '#DB2777', '#FFFFFF', 6)
  on conflict (name) do nothing;

  create temp table seed_products (
    sort_order int, category text, name text, price int, content_type public.content_type,
    quantity int, usage_rule public.usage_rule, slot_start time, slot_end time, branch_codes text[]
  ) on commit drop;
  insert into seed_products values
    (10, '成人票', '平日 成人全天', 500, 'single', 1, 'weekday', null, null, array['MD']),
    (20, '成人票', '平日 成人白天', 350, 'single', 1, 'weekday', '12:00', '18:00', array['MD']),
    (30, '成人票', '平日 成人晚上', 450, 'single', 1, 'weekday', '17:00', '23:00', array['MD']),
    (40, '成人票', '平日 成人星光', 320, 'single', 1, 'weekday', '20:30', '23:00', array['MD']),
    (50, '學生票', '平日 學生全天', 350, 'single', 1, 'weekday', null, null, array['MD']),
    (60, '學生票', '平日 學生白天', 280, 'single', 1, 'weekday', '12:00', '18:00', array['MD']),
    (70, '學生票', '平日 學生晚上', 300, 'single', 1, 'weekday', '17:00', '23:00', array['MD']),
    (80, '學生票', '平日 學生星光', 250, 'single', 1, 'weekday', '20:30', '23:00', array['MD']),
    (90, '兒童幼兒票', '平日 兒童全天', 250, 'single', 1, 'weekday', null, null, array['MD']),
    (100, '兒童幼兒票', '平日 幼兒全天', 200, 'single', 1, 'weekday', null, null, array['MD']),
    (110, '成人票', '平日 成人全天', 450, 'single', 1, 'weekday', null, null, array['WH']),
    (120, '成人票', '平日 成人白天', 350, 'single', 1, 'weekday', '10:00', '18:00', array['WH']),
    (130, '成人票', '平日 成人晚上', 420, 'single', 1, 'weekday', '17:00', '23:00', array['WH']),
    (140, '成人票', '平日 成人星光', 320, 'single', 1, 'weekday', '20:30', '23:00', array['WH']),
    (150, '學生票', '平日 學生全天', 350, 'single', 1, 'weekday', null, null, array['WH']),
    (160, '學生票', '平日 學生白天', 280, 'single', 1, 'weekday', '10:00', '18:00', array['WH']),
    (170, '學生票', '平日 學生晚上', 300, 'single', 1, 'weekday', '17:00', '23:00', array['WH']),
    (180, '學生票', '平日 學生星光', 250, 'single', 1, 'weekday', '20:30', '23:00', array['WH']),
    (190, '兒童幼兒票', '平日 兒童早鳥', 200, 'single', 1, 'weekday', '10:00', '13:00', array['WH']),
    (200, '兒童幼兒票', '平日 兒童全天', 250, 'single', 1, 'weekday', null, null, array['WH']),
    (210, '兒童幼兒票', '平日 幼兒全天', 200, 'single', 1, 'weekday', null, null, array['WH']),
    (220, '成人票', '平日 成人全天', 450, 'single', 1, 'weekday', null, null, array['NG']),
    (230, '成人票', '平日 成人白天', 320, 'single', 1, 'weekday', '12:00', '18:00', array['NG']),
    (240, '成人票', '平日 成人晚上', 400, 'single', 1, 'weekday', '17:00', '23:00', array['NG']),
    (250, '成人票', '平日 成人星光', 300, 'single', 1, 'weekday', '20:30', '23:00', array['NG']),
    (260, '學生票', '平日 學生全天', 350, 'single', 1, 'weekday', null, null, array['NG']),
    (270, '學生票', '平日 學生白天', 250, 'single', 1, 'weekday', '12:00', '18:00', array['NG']),
    (280, '學生票', '平日 學生晚上', 300, 'single', 1, 'weekday', '17:00', '23:00', array['NG']),
    (290, '學生票', '平日 學生星光', 250, 'single', 1, 'weekday', '20:30', '23:00', array['NG']),
    (300, '兒童幼兒票', '平日 兒童全天', 250, 'single', 1, 'weekday', null, null, array['NG']),
    (310, '兒童幼兒票', '平日 幼兒全天', 200, 'single', 1, 'weekday', null, null, array['NG']),
    (320, '成人票', '平日 成人全天', 500, 'single', 1, 'weekday', null, null, array['ZH']),
    (330, '成人票', '平日 成人白天', 350, 'single', 1, 'weekday', '12:00', '18:00', array['ZH']),
    (340, '成人票', '平日 成人晚上', 450, 'single', 1, 'weekday', '17:00', '23:00', array['ZH']),
    (350, '成人票', '平日 成人星光', 320, 'single', 1, 'weekday', '20:30', '23:00', array['ZH']),
    (360, '學生票', '平日 學生全天', 400, 'single', 1, 'weekday', null, null, array['ZH']),
    (370, '學生票', '平日 學生白天', 250, 'single', 1, 'weekday', '12:00', '18:00', array['ZH']),
    (380, '學生票', '平日 學生晚上', 320, 'single', 1, 'weekday', '17:00', '23:00', array['ZH']),
    (390, '學生票', '平日 學生星光', 250, 'single', 1, 'weekday', '20:30', '23:00', array['ZH']),
    (400, '兒童幼兒票', '平日 兒童全天', 250, 'single', 1, 'weekday', null, null, array['ZH']),
    (410, '兒童幼兒票', '平日 幼兒全天', 200, 'single', 1, 'weekday', null, null, array['ZH']),
    (420, '成人票', '假日 成人全天', 550, 'single', 1, 'weekend', null, null, array['MD']),
    (430, '成人票', '假日 成人星光', 320, 'single', 1, 'weekend', '19:30', '22:00', array['MD']),
    (440, '學生票', '假日 學生全天', 350, 'single', 1, 'weekend', null, null, array['MD']),
    (450, '學生票', '假日 學生星光', 250, 'single', 1, 'weekend', '19:30', '22:00', array['MD']),
    (460, '兒童幼兒票', '假日 兒童全天', 250, 'single', 1, 'weekend', null, null, array['MD']),
    (470, '兒童幼兒票', '假日 幼兒全天', 200, 'single', 1, 'weekend', null, null, array['MD']),
    (480, '成人票', '假日 成人全天', 500, 'single', 1, 'weekend', null, null, array['WH']),
    (490, '成人票', '假日 成人星光', 320, 'single', 1, 'weekend', '18:30', '21:00', array['WH']),
    (500, '學生票', '假日 學生全天', 350, 'single', 1, 'weekend', null, null, array['WH']),
    (510, '學生票', '假日 學生星光', 250, 'single', 1, 'weekend', '18:30', '21:00', array['WH']),
    (520, '兒童幼兒票', '假日 兒童全天', 250, 'single', 1, 'weekend', null, null, array['WH']),
    (530, '兒童幼兒票', '假日 幼兒全天', 200, 'single', 1, 'weekend', null, null, array['WH']),
    (540, '成人票', '假日 成人全天', 450, 'single', 1, 'weekend', null, null, array['NG']),
    (550, '成人票', '假日 成人星光', 300, 'single', 1, 'weekend', '18:30', '21:00', array['NG']),
    (560, '學生票', '假日 學生全天', 350, 'single', 1, 'weekend', null, null, array['NG']),
    (570, '學生票', '假日 學生星光', 250, 'single', 1, 'weekend', '18:30', '21:00', array['NG']),
    (580, '兒童幼兒票', '假日 兒童全天', 250, 'single', 1, 'weekend', null, null, array['NG']),
    (590, '兒童幼兒票', '假日 幼兒全天', 200, 'single', 1, 'weekend', null, null, array['NG']),
    (600, '成人票', '假日 成人全天', 550, 'single', 1, 'weekend', null, null, array['ZH']),
    (610, '成人票', '假日 成人星光', 320, 'single', 1, 'weekend', '19:00', '22:00', array['ZH']),
    (620, '學生票', '假日 學生全天', 400, 'single', 1, 'weekend', null, null, array['ZH']),
    (630, '學生票', '假日 學生星光', 250, 'single', 1, 'weekend', '19:00', '22:00', array['ZH']),
    (640, '兒童幼兒票', '假日 兒童全天', 250, 'single', 1, 'weekend', null, null, array['ZH']),
    (650, '兒童幼兒票', '假日 幼兒全天', 200, 'single', 1, 'weekend', null, null, array['ZH']),
    (660, '成人票', '平日 成人全天', 500, 'single', 1, 'weekday', null, null, array['ZL']),
    (670, '成人票', '平日 成人下午', 350, 'single', 1, 'weekday', '11:00', '18:00', array['ZL']),
    (680, '成人票', '平日 成人晚上', 400, 'single', 1, 'weekday', '16:00', '23:00', array['ZL']),
    (690, '成人票', '平日 成人星光', 300, 'single', 1, 'weekday', '20:30', '23:00', array['ZL']),
    (700, '學生票', '平日 學生全天', 400, 'single', 1, 'weekday', null, null, array['ZL']),
    (710, '學生票', '平日 學生下午', 250, 'single', 1, 'weekday', '11:00', '18:00', array['ZL']),
    (720, '學生票', '平日 學生晚上', 320, 'single', 1, 'weekday', '16:00', '23:00', array['ZL']),
    (730, '學生票', '平日 學生星光', 250, 'single', 1, 'weekday', '20:30', '23:00', array['ZL']),
    (740, '成人票', '假日 成人全天', 550, 'single', 1, 'weekend', null, null, array['ZL']),
    (750, '成人票', '假日 成人星光', 300, 'single', 1, 'weekend', '19:30', '22:00', array['ZL']),
    (760, '成人票', '假日 成人三小時', 400, 'single', 1, 'weekend', null, null, array['ZL']),
    (770, '學生票', '假日 學生全天', 400, 'single', 1, 'weekend', null, null, array['ZL']),
    (780, '學生票', '假日 學生星光', 250, 'single', 1, 'weekend', '19:30', '22:00', array['ZL']),
    (790, '學生票', '假日 學生三小時', 320, 'single', 1, 'weekend', null, null, array['ZL']),
    (800, '成人票', '平日 成人全天', 500, 'single', 1, 'weekday', null, null, array['XD']),
    (810, '成人票', '平日 成人三小時', 400, 'single', 1, 'weekday', null, null, array['XD']),
    (820, '成人票', '平日 成人星光', 300, 'single', 1, 'weekday', '20:30', '23:00', array['XD']),
    (830, '學生票', '平日 學生全天', 400, 'single', 1, 'weekday', null, null, array['XD']),
    (840, '學生票', '平日 學生三小時', 300, 'single', 1, 'weekday', null, null, array['XD']),
    (850, '學生票', '平日 學生星光', 250, 'single', 1, 'weekday', '20:30', '23:00', array['XD']),
    (860, '兒童幼兒票', '平日 兒童全天', 250, 'single', 1, 'weekday', null, null, array['XD']),
    (870, '成人票', '假日 成人全天', 550, 'single', 1, 'weekend', null, null, array['XD']),
    (880, '成人票', '假日 成人三小時', 400, 'single', 1, 'weekend', null, null, array['XD']),
    (890, '成人票', '假日 成人星光', 300, 'single', 1, 'weekend', '19:00', '22:00', array['XD']),
    (900, '學生票', '假日 學生全天', 400, 'single', 1, 'weekend', null, null, array['XD']),
    (910, '學生票', '假日 學生三小時', 300, 'single', 1, 'weekend', null, null, array['XD']),
    (920, '學生票', '假日 學生星光', 250, 'single', 1, 'weekend', '19:00', '22:00', array['XD']),
    (930, '兒童幼兒票', '假日 兒童兩小時（含裝備）', 500, 'single', 1, 'weekend', null, null, array['XD']),
    (940, '兒童幼兒票', '假日 兒童三小時（含裝備）', 600, 'single', 1, 'weekend', null, null, array['XD']),
    (950, '陪同入場', '單純入場（不攀爬）', 100, 'single', 1, 'any', null, null, array['MD']),
    (960, '陪同入場', '單純入場（不攀爬）', 100, 'single', 1, 'any', null, null, array['WH']),
    (970, '陪同入場', '單純入場（不攀爬）', 100, 'single', 1, 'any', null, null, array['NG']),
    (980, '陪同入場', '單純入場（不攀爬）', 100, 'single', 1, 'any', null, null, array['ZH']),
    (990, '陪同入場', '單純入場（不攀爬）', 100, 'single', 1, 'any', null, null, array['ZL']),
    (1000, '陪同入場', '單純入場（不攀爬）', 100, 'single', 1, 'any', null, null, array['XD']),
    (1010, '團體課程', '幼兒課（6堂）', 2500, 'course', 6, 'any', null, null, array['WH','NG','MD']),
    (1020, '團體課程', '幼兒課（6堂）', 3000, 'course', 6, 'any', null, null, array['ZH']),
    (1030, '團體課程', '幼兒課（6堂）', 3000, 'course', 6, 'any', null, null, array['ZL']),
    (1040, '團體課程', '幼兒課 單堂試上', 500, 'course', 1, 'any', null, null, array['WH','NG','MD']),
    (1050, '團體課程', '幼兒課 單堂試上', 600, 'course', 1, 'any', null, null, array['ZH']),
    (1060, '團體課程', '兒童課（6堂）', 3600, 'course', 6, 'any', null, null, array['WH','NG','MD']),
    (1070, '團體課程', '兒童課（6堂）', 4000, 'course', 6, 'any', null, null, array['ZH','ZL']),
    (1080, '團體課程', '兒童課（6堂）', 4200, 'course', 6, 'any', null, null, array['XD']),
    (1090, '團體課程', '兒童課 單堂試上', 750, 'course', 1, 'any', null, null, array['WH','NG','MD']),
    (1100, '團體課程', '兒童課 單堂試上', 800, 'course', 1, 'any', null, null, array['ZH','XD']),
    (1110, '團體課程', '青少年課（6堂）', 4200, 'course', 6, 'any', null, null, array['WH','MD']),
    (1120, '團體課程', '青少年課（6堂）', 4500, 'course', 6, 'any', null, null, array['ZH','ZL','XD']),
    (1130, '團體課程', '青少年課 單堂試上', 900, 'course', 1, 'any', null, null, array['WH','MD']),
    (1140, '團體課程', '青少年訓練課（8堂）', 6000, 'course', 8, 'any', null, null, array['ZH','ZL','XD']),
    (1150, '團體課程', '成人抱石課 新生（4堂）', 4500, 'course', 4, 'any', null, null, array['WH','NG','MD','ZL']),
    (1160, '團體課程', '成人抱石課 舊生（4堂）', 4200, 'course', 4, 'any', null, null, array['WH','NG','MD','ZL']),
    (1170, '團體課程', '成人技巧課（4堂）', 5000, 'course', 4, 'any', null, null, array['ZH','XD']),
    (1180, '團體課程', '成人初岩課（5堂）', 5500, 'course', 5, 'any', null, null, array['ZH','ZL','XD']),
    (1190, '團體課程', '成人先鋒課（6堂）', 7500, 'course', 6, 'any', null, null, array['ZH','ZL','XD']),
    (1200, '團體課程', '親子抱石課（4堂，每人）', 3900, 'course', 4, 'any', null, null, array['WH','NG','MD','ZL','XD']),
    (1210, '團體課程', '親子課（4堂，每人）', 4500, 'course', 4, 'any', null, null, array['ZH']),
    (1220, '團體課程', '系統轉換課', 2000, 'course', 1, 'any', null, null, array['ZH']),
    (1230, '團體課程', '原岩攀岩隊（8堂）', 4000, 'course', 8, 'any', null, null, null),
    (1240, '一對一課程', '特殊生一對一 兒童／幼兒（8堂）', 4800, 'course', 8, 'any', null, null, null),
    (1250, '一對一課程', '一對一 兒童／青少年（4堂）', 5000, 'course', 4, 'any', null, null, null),
    (1260, '一對一課程', '一對一 成人（4堂）', 6000, 'course', 4, 'any', null, null, null),
    (1270, '一對一課程', '一對一 初岩確保（5堂）', 10000, 'course', 5, 'any', null, null, array['ZH','ZL','XD']),
    (1280, '一對一課程', '一對一 先鋒確保（6堂）', 12000, 'course', 6, 'any', null, null, array['ZH','ZL','XD']);

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

