-- =====================================================================
-- 放入分館資料（可重複執行：已存在的分館會更新成這裡的內容）
-- 顏色欄位需先執行 migration 20260929000006_branch_color.sql
-- 中壢店尚未開幕：先設為「未營運」，開幕時再改成營運中並補上地址電話
-- =====================================================================
insert into public.branches (code, name, address, phone, sort_order, is_active, color) values
  ('WH', '萬華店', '10855 台北市萬華區大理街149號',                        '02-2308-8250', 1, true, '#6B4FA3'),
  ('ZH', '中和店', '23557 新北市中和區立言街41號',                         '02-8228-2555', 2, true, '#1E8A6E'),
  ('NG', '南港店', '11578 台北市南港區南港路二段147號',                    '02-2651-9555', 3, true, '#A8741A'),
  ('XD', '新店店', '23146 新北市新店區中興路三段70號（YES!LIFE 裕隆城7樓）', '02-8914-7755', 4, true, '#D9661F'),
  ('MD', '明德店', '11287 台北市北投區文林北路222號B1',                    '02-2821-9988', 5, true, '#B83A52'),
  ('ZL', '中壢店', '320 桃園市中壢區（詳細地址未公布）',                   null,           6, false, '#2A74B5')
on conflict (code) do update set
  name = excluded.name, address = excluded.address, phone = excluded.phone,
  sort_order = excluded.sort_order, is_active = excluded.is_active, color = excluded.color;

select code as 代碼, name as 分館, phone as 電話, is_active as 營運中
from public.branches order by sort_order;
