-- =====================================================================
-- 原岩攀岩館 會員與櫃檯系統
-- 第 6 部分：分館主題色（櫃檯系統上方色帶、按鈕等會用這個顏色，一眼看出是哪間店）
-- 顏色參考老闆價目表上各館的底色，加深以便白字清楚。總部可在後台修改。
-- =====================================================================

alter table public.branches
  add column color text not null default '#1F6F5C' check (color ~ '^#[0-9A-Fa-f]{6}$');
comment on column public.branches.color is '分館主題色（櫃檯畫面色帶）';

update public.branches set color = case code
  when 'MD' then '#B83A52'  -- 明德：玫瑰紅
  when 'WH' then '#6B4FA3'  -- 萬華：紫
  when 'NG' then '#A8741A'  -- 南港：琥珀
  when 'ZH' then '#1E8A6E'  -- 中和：薄荷綠
  when 'ZL' then '#2A74B5'  -- 中壢（A19）：藍
  when 'XD' then '#D9661F'  -- 新店：橘
  else color end;
