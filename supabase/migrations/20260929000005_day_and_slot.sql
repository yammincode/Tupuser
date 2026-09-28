-- =====================================================================
-- 原岩攀岩館 會員與櫃檯系統
-- 第 5 部分：讓品項可以同時限制「平日／假日」與「時段」
-- 例：平日白天票 = 平日 + 12:00～18:00；假日星光票 = 假日 + 19:30～22:00
--
-- 規則：
--   usage_rule  決定哪幾天可用（any 不限／weekday 平日／weekend 假日／time_slot 不限日期但限時段）
--   slot_start、slot_end 有填時，另外限制時段（任何 usage_rule 都可以搭配）
-- =====================================================================

alter table public.products drop constraint slot_required;
alter table public.products add constraint slot_valid check (
  (slot_start is null and slot_end is null)
  or (slot_start is not null and slot_end is not null and slot_start < slot_end)
);
alter table public.products add constraint slot_required check (
  usage_rule <> 'time_slot' or slot_start is not null
);

comment on column public.products.usage_rule is '哪幾天可用：any 不限／weekday 平日／weekend 假日／time_slot 不限日期但限時段';
comment on column public.products.slot_start is '時段開始（選填，可搭配平日／假日）';

create or replace function app.plan_block_reason(p public.member_plans, p_branch uuid)
returns public.checkin_result
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_today date := app.today(); v_time time := app.now_tpe()::time;
begin
  if p.status in ('frozen', 'cancelled') then return 'no_valid_plan'; end if;
  if p.start_date is not null and p.start_date > v_today then return 'no_valid_plan'; end if;
  if p.end_date is not null and p.end_date < v_today then return 'plan_expired'; end if;
  if p.content_type <> 'days' and coalesce(p.remaining_count, 0) <= 0 then return 'no_remaining'; end if;
  if p.branch_ids is not null and not (p_branch = any (p.branch_ids)) then return 'branch_not_allowed'; end if;
  if p.usage_rule = 'weekday' and app.is_holiday(v_today) then return 'not_allowed_now'; end if;
  if p.usage_rule = 'weekend' and not app.is_holiday(v_today) then return 'not_allowed_now'; end if;
  if p.slot_start is not null and not (v_time >= p.slot_start and v_time < p.slot_end) then
    return 'not_allowed_now';
  end if;
  return null;
end $$;
