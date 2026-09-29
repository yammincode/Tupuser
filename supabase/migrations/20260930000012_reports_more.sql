-- =====================================================================
-- 原岩攀岩館 會員與櫃檯系統
-- 第 12 部分：報表擴充（老闆 2026-09-30 決定全部做）
--   report_sales      ：依分類、品項、付款方式、折扣、業務代表、客單價
--   report_checkins   ：依票種的入場人次／人數、入場方式、被擋下原因、尖峰時段、平日假日
--   report_trend      ：每月、每年營收（含各分館、各分類），比較上月與去年同期
--   report_liability  ：套票未使用餘額（售價 ÷ 次數；天數型依剩餘天數比例）
--   report_members    ：即將到期、很久沒來、新會員回訪
-- 權限：總部看全部或指定分館；店長只看自己分館
-- 營收口徑與 sales_report 相同：未作廢訂單的金額算在銷售日；退費另計在退費日
-- =====================================================================

-- 報表要看哪些分館
create or replace function app.report_branches(p_branch_id uuid) returns uuid[]
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.staff;
begin
  s := app.require_staff(array['hq', 'manager']::public.staff_role[]);
  if s.role = 'manager' then return array[s.branch_id]; end if;
  if p_branch_id is not null then return array[p_branch_id]; end if;
  return (select array_agg(id) from public.branches);
end $$;

create or replace function app.report_check_range(p_from date, p_to date) returns void
language plpgsql immutable as $$
begin
  if p_from is null or p_to is null or p_from > p_to then
    raise exception '請選擇正確的日期區間' using errcode = '22023';
  end if;
  if p_to - p_from > 366 then
    raise exception '日期區間最多一年' using errcode = '22023';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. 銷售明細
-- ---------------------------------------------------------------------
create or replace function public.report_sales(p_from date, p_to date, p_branch_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_b uuid[];
begin
  v_b := app.report_branches(p_branch_id);
  perform app.report_check_range(p_from, p_to);

  return (
  with _rs_orders as (
    select * from public.orders o
    where o.branch_id = any (v_b) and o.business_date between p_from and p_to and o.status <> 'voided')
  select jsonb_build_object(
    'summary', (select jsonb_build_object(
        'orders', count(*),
        'sales', coalesce(sum(o.total), 0),
        'discount', coalesce(sum(o.discount_amount), 0)
                    + coalesce((select sum(oi.discount_amount) from public.order_items oi
                                where oi.order_id in (select id from _rs_orders)), 0),
        'avg_ticket', coalesce(round(avg(o.total)), 0),
        'refunds', (select coalesce(sum(r.amount), 0) from public.refunds r
                    where r.branch_id = any (v_b) and r.business_date between p_from and p_to),
        'members', count(distinct o.member_id))
      from _rs_orders o),
    -- 依分類（以品項目前的分類歸類）
    'by_category', (select coalesce(jsonb_agg(x order by x.sort_order), '[]'::jsonb) from (
        select c.id, c.name, c.bg_color as bg, c.text_color as fg, c.dot_color as dot, c.sort_order,
               sum(oi.quantity)::int as quantity, sum(oi.line_total)::int as amount
        from public.order_items oi
        join _rs_orders o on o.id = oi.order_id
        join public.products p on p.id = oi.product_id
        join public.product_categories c on c.id = p.category_id
        group by c.id) x),
    -- 品項（前 100 名，畫面可依分類篩選）
    'items', (select coalesce(jsonb_agg(x order by x.amount desc), '[]'::jsonb) from (
        select oi.product_name as name, c.name as category, sum(oi.quantity)::int as quantity,
               sum(oi.line_total)::int as amount
        from public.order_items oi
        join _rs_orders o on o.id = oi.order_id
        join public.products p on p.id = oi.product_id
        join public.product_categories c on c.id = p.category_id
        group by oi.product_name, c.name order by amount desc limit 100) x),
    -- 付款方式
    'payments', (select coalesce(jsonb_agg(x order by x.amount desc), '[]'::jsonb) from (
        select pm.method, count(*)::int as count, sum(pm.amount)::int as amount
        from public.payments pm join _rs_orders o on o.id = pm.order_id
        group by pm.method) x),
    'mixed_orders', (select count(*) from _rs_orders o
                     where (select count(distinct method) from public.payments where order_id = o.id) > 1),
    -- 折扣原因（整筆訂單的折扣）
    'discounts', (select coalesce(jsonb_agg(x order by x.amount desc), '[]'::jsonb) from (
        select coalesce(nullif(trim(o.discount_reason), ''), '未填原因') as reason,
               count(*)::int as count, sum(o.discount_amount)::int as amount
        from _rs_orders o where o.discount_amount > 0
        group by 1) x),
    -- 業務代表業績
    'by_staff', (select coalesce(jsonb_agg(x order by x.amount desc), '[]'::jsonb) from (
        select coalesce(st.name, '未指定') as name, count(*)::int as orders, sum(o.total)::int as amount
        from _rs_orders o left join public.staff st on st.id = o.sales_staff_id
        group by st.name) x)
  ));
end $$;

-- ---------------------------------------------------------------------
-- 2. 入場統計
-- ---------------------------------------------------------------------
create or replace function public.report_checkins(p_from date, p_to date, p_branch_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_b uuid[];
begin
  v_b := app.report_branches(p_branch_id);
  perform app.report_check_range(p_from, p_to);

  return (
  with _rc as (
    select c.*, p.content_type, p.name as plan_name from public.checkins c
    left join public.member_plans p on p.id = c.member_plan_id
    where c.branch_id = any (v_b) and c.business_date between p_from and p_to and c.cancelled_at is null)
  select jsonb_build_object(
    'summary', (select jsonb_build_object(
        'visits', count(*) filter (where result = 'success'),
        'people', count(distinct member_id) filter (where result = 'success'),
        'blocked', count(*) filter (where result <> 'success'),
        'days', p_to - p_from + 1)
      from _rc),
    -- 依票種：單次、次數（十次券）、天數（月票）、課程
    'by_type', (select coalesce(jsonb_agg(x order by x.visits desc), '[]'::jsonb) from (
        select content_type, count(*)::int as visits, count(distinct member_id)::int as people
        from _rc where result = 'success' group by content_type) x),
    -- 依方案名稱
    'by_plan', (select coalesce(jsonb_agg(x order by x.visits desc), '[]'::jsonb) from (
        select plan_name as name, content_type, count(*)::int as visits, count(distinct member_id)::int as people,
               count(*) filter (where deducted)::int as deducted
        from _rc where result = 'success' group by plan_name, content_type order by visits desc limit 30) x),
    'by_method', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select method, count(*)::int as visits from _rc where result = 'success' group by method) x),
    -- 被擋下原因
    'blocked', (select coalesce(jsonb_agg(x order by x.count desc), '[]'::jsonb) from (
        select result, count(*)::int as count, count(distinct member_id)::int as people
        from _rc where result <> 'success' group by result) x),
    -- 尖峰時段：星期（1 = 週一 … 7 = 週日）× 小時（台灣時間）
    'heatmap', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select extract(isodow from business_date)::int as dow,
               extract(hour from checked_in_at at time zone 'Asia/Taipei')::int as hour,
               count(*)::int as visits
        from _rc where result = 'success' group by 1, 2) x),
    -- 平日與假日（含國定假日），平均每天人次
    'day_kind', (select jsonb_build_object(
        'weekday_days', count(*) filter (where not app.is_holiday(d::date)),
        'holiday_days', count(*) filter (where app.is_holiday(d::date)),
        'weekday_visits', (select count(*) from _rc where result = 'success' and not app.is_holiday(business_date)),
        'holiday_visits', (select count(*) from _rc where result = 'success' and app.is_holiday(business_date)))
      from generate_series(p_from, p_to, interval '1 day') d)
  ));
end $$;

-- ---------------------------------------------------------------------
-- 3. 每月、每年比較
-- ---------------------------------------------------------------------
create or replace function public.report_trend(p_branch_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_b uuid[];
  v_today date := app.today();
  v_start date := (date_trunc('month', app.today()) - interval '24 months')::date;  -- 最近 25 個月（可比較去年同月）
begin
  v_b := app.report_branches(p_branch_id);
  return jsonb_build_object(
    'months', (select coalesce(jsonb_agg(x order by x.month), '[]'::jsonb) from (
        select to_char(m, 'YYYY-MM') as month,
          coalesce((select sum(o.total) from public.orders o where o.branch_id = any (v_b) and o.status <> 'voided'
                    and o.business_date >= m and o.business_date < m + interval '1 month'), 0)::int as sales,
          coalesce((select sum(r.amount) from public.refunds r where r.branch_id = any (v_b)
                    and r.business_date >= m and r.business_date < m + interval '1 month'), 0)::int as refunds,
          (select count(*) from public.orders o where o.branch_id = any (v_b) and o.status <> 'voided'
                    and o.business_date >= m and o.business_date < m + interval '1 month')::int as orders,
          (select count(*) from public.checkins c where c.branch_id = any (v_b) and c.result = 'success'
                    and c.cancelled_at is null
                    and c.business_date >= m and c.business_date < m + interval '1 month')::int as checkins,
          (select count(*) from public.members mb where mb.home_branch_id = any (v_b)
                    and (mb.created_at at time zone 'Asia/Taipei')::date >= m
                    and (mb.created_at at time zone 'Asia/Taipei')::date < m + interval '1 month')::int as new_members
        from generate_series(v_start, v_today, interval '1 month') m) x),
    -- 每年：總額、各分館、各分類
    'years', (select coalesce(jsonb_agg(y order by y.year), '[]'::jsonb) from (
        select yr as year,
          coalesce((select sum(o.total) from public.orders o where o.branch_id = any (v_b) and o.status <> 'voided'
                    and extract(year from o.business_date) = yr), 0)::int as sales,
          coalesce((select sum(r.amount) from public.refunds r where r.branch_id = any (v_b)
                    and extract(year from r.business_date) = yr), 0)::int as refunds,
          (select count(*) from public.checkins c where c.branch_id = any (v_b) and c.result = 'success'
                    and c.cancelled_at is null and extract(year from c.business_date) = yr)::int as checkins,
          -- 今年到今天為止的「去年同期」（比較用）
          coalesce((select sum(o.total) from public.orders o where o.branch_id = any (v_b) and o.status <> 'voided'
                    and extract(year from o.business_date) = yr
                    and to_char(o.business_date, 'MMDD') <= to_char(v_today, 'MMDD')), 0)::int as sales_ytd,
          (select coalesce(jsonb_agg(b order by b.sort_order), '[]'::jsonb) from (
              select br.name, br.sort_order,
                coalesce((select sum(o.total) from public.orders o where o.branch_id = br.id and o.status <> 'voided'
                          and extract(year from o.business_date) = yr), 0)::int
                - coalesce((select sum(r.amount) from public.refunds r where r.branch_id = br.id
                          and extract(year from r.business_date) = yr), 0)::int as net
              from public.branches br where br.id = any (v_b)) b) as by_branch,
          (select coalesce(jsonb_agg(c order by c.sort_order), '[]'::jsonb) from (
              select pc.name, pc.dot_color as dot, pc.sort_order, sum(oi.line_total)::int as amount
              from public.order_items oi
              join public.orders o on o.id = oi.order_id
              join public.products p on p.id = oi.product_id
              join public.product_categories pc on pc.id = p.category_id
              where o.branch_id = any (v_b) and o.status <> 'voided' and extract(year from o.business_date) = yr
              group by pc.id) c) as by_category
        from generate_series(
               coalesce((select extract(year from min(business_date))::int from public.orders where branch_id = any (v_b)),
                        extract(year from v_today)::int),
               extract(year from v_today)::int) yr) y)
  );
end $$;

-- ---------------------------------------------------------------------
-- 4. 套票未使用餘額（到今天為止，會員還沒用掉、已先收款的部分）
--    次數型／課程：每個方案的售價 × 剩餘次數 ÷ 總次數
--    天數型：售價 × 剩餘天數 ÷ 總天數（暫停中以暫停日起算）
--    沒有售價的方案（櫃檯手動新增）只算數量、不算金額
-- ---------------------------------------------------------------------
create or replace function public.report_liability(p_branch_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_b uuid[]; v_today date := app.today();
begin
  v_b := app.report_branches(p_branch_id);

  return (
  with base as (
    select p.id as plan_id, p.name, p.content_type, o.branch_id,
           oi.line_total::numeric / greatest(oi.quantity, 1) as price,
           case when p.content_type = 'days'
                then greatest(p.end_date - greatest(coalesce(p.frozen_at, v_today), p.start_date) + 1, 0)
                else p.remaining_count end as remaining_units,
           case when p.content_type = 'days' then p.end_date - p.start_date + 1 else p.total_count end as total_units
    from public.member_plans p
    left join public.order_items oi on oi.id = p.order_item_id
    left join public.orders o on o.id = oi.order_id
    where p.status in ('active', 'frozen')
      and (p.content_type <> 'days' or p.end_date >= v_today)
      and (p.content_type = 'days' or p.remaining_count > 0)
      and (o.branch_id = any (v_b) or (o.id is null and p_branch_id is null and cardinality(v_b) > 1))),
  _rl as (
    select *, coalesce(round(price * remaining_units / nullif(total_units, 0)), 0)::int as value from base)
  select jsonb_build_object(
    'as_of', v_today,
    'total', coalesce((select sum(value) from _rl), 0),
    'plans', (select count(*) from _rl),
    'no_price_plans', (select count(*) from _rl where price is null),
    'by_type', (select coalesce(jsonb_agg(x order by x.value desc), '[]'::jsonb) from (
        select content_type, count(*)::int as plans, sum(remaining_units)::int as units, coalesce(sum(value), 0)::int as value
        from _rl group by content_type) x),
    'by_product', (select coalesce(jsonb_agg(x order by x.value desc), '[]'::jsonb) from (
        select name, content_type, count(*)::int as plans, sum(remaining_units)::int as units, coalesce(sum(value), 0)::int as value
        from _rl group by name, content_type order by value desc limit 50) x),
    'by_branch', (select coalesce(jsonb_agg(x order by x.sort_order), '[]'::jsonb) from (
        select coalesce(b.name, '手動新增') as name, coalesce(b.sort_order, 999) as sort_order,
               count(*)::int as plans, coalesce(sum(value), 0)::int as value
        from _rl left join public.branches b on b.id = _rl.branch_id group by b.name, b.sort_order) x)
  ));
end $$;

-- ---------------------------------------------------------------------
-- 5. 會員：即將到期、很久沒來、新會員回訪
--    分館以會員的「主要分館」為準
-- ---------------------------------------------------------------------
create or replace function public.report_members(
  p_branch_id uuid default null, p_expire_days integer default 30, p_inactive_days integer default 30,
  p_from date default null, p_to date default null
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_b uuid[];
  v_today date := app.today();
  v_from date := coalesce(p_from, date_trunc('month', app.today())::date);
  v_to date := coalesce(p_to, app.today());
  v_exp integer := least(greatest(coalesce(p_expire_days, 30), 1), 180);
  v_ina integer := least(greatest(coalesce(p_inactive_days, 30), 7), 365);
begin
  v_b := app.report_branches(p_branch_id);
  perform app.report_check_range(v_from, v_to);

  return jsonb_build_object(
    -- 即將到期：天數型 N 天內到期；次數型剩 2 次以下（課程不列）
    'expiring', (select coalesce(jsonb_agg(x order by x.sort_key), '[]'::jsonb) from (
        select m.id as member_id, m.name, m.phone, m.member_no, m.marketing_opt_in, b.name as branch,
               p.name as plan, p.content_type, p.end_date, p.remaining_count,
               (select max(c.business_date) from public.checkins c where c.member_id = m.id and c.result = 'success'
                  and c.cancelled_at is null) as last_visit,
               coalesce(p.end_date, v_today + p.remaining_count) as sort_key
        from public.member_plans p
        join public.members m on m.id = p.member_id and m.status = 'active'
        join public.branches b on b.id = m.home_branch_id
        where m.home_branch_id = any (v_b) and p.status = 'active' and p.content_type in ('punch', 'days')
          and ((p.content_type = 'days' and p.end_date between v_today and v_today + v_exp)
               or (p.content_type = 'punch' and p.remaining_count between 1 and 2))
          -- 已經另外買了新方案的不列
          and not exists (select 1 from public.member_plans n where n.member_id = m.id and n.id <> p.id
                          and n.status = 'active' and n.content_type in ('punch', 'days')
                          and n.created_at > p.created_at)
        order by sort_key limit 300) x),
    -- 很久沒來：有可用方案，但超過 N 天沒有入場（從未入場則以購買日起算）
    'inactive', (select coalesce(jsonb_agg(x order by x.idle_days desc), '[]'::jsonb) from (
        select m.id as member_id, m.name, m.phone, m.member_no, m.marketing_opt_in, b.name as branch,
               string_agg(distinct p.name, '、') as plans, max(lv.last_visit) as last_visit,
               v_today - coalesce(max(lv.last_visit), min(p.start_date)) as idle_days
        from public.members m
        join public.branches b on b.id = m.home_branch_id
        join public.member_plans p on p.member_id = m.id and p.status = 'active'
             and p.content_type in ('punch', 'days')
             and (p.end_date is null or p.end_date >= v_today)
             and (p.content_type = 'days' or p.remaining_count > 0)
        left join lateral (select max(c.business_date) as last_visit from public.checkins c
                           where c.member_id = m.id and c.result = 'success' and c.cancelled_at is null) lv on true
        where m.home_branch_id = any (v_b) and m.status = 'active'
        group by m.id, b.name
        having v_today - coalesce(max(lv.last_visit), min(p.start_date)) >= v_ina
        order by idle_days desc limit 300) x),
    -- 新會員與回訪：註冊後 30 天內，在「註冊以外的另一天」有入場算回訪
    'new_members', (select coalesce(jsonb_agg(x order by x.sort_order), '[]'::jsonb) from (
        select b.name, b.sort_order, count(m.id)::int as joined,
               count(m.id) filter (where exists (
                 select 1 from public.checkins c where c.member_id = m.id and c.result = 'success'
                   and c.cancelled_at is null
                   and c.business_date > (m.created_at at time zone 'Asia/Taipei')::date
                   and c.business_date <= (m.created_at at time zone 'Asia/Taipei')::date + 30))::int as returned,
               count(m.id) filter (where (m.created_at at time zone 'Asia/Taipei')::date + 30 > v_today)::int as too_new
        from public.branches b
        left join public.members m on m.home_branch_id = b.id
             and (m.created_at at time zone 'Asia/Taipei')::date between v_from and v_to
        where b.id = any (v_b)
        group by b.id) x),
    'params', jsonb_build_object('expire_days', v_exp, 'inactive_days', v_ina, 'from', v_from, 'to', v_to)
  );
end $$;

revoke all on function app.report_branches(uuid) from public, anon, authenticated;
revoke all on function app.report_check_range(date, date) from public, anon, authenticated;
revoke all on function public.report_sales(date, date, uuid) from public, anon;
revoke all on function public.report_checkins(date, date, uuid) from public, anon;
revoke all on function public.report_trend(uuid) from public, anon;
revoke all on function public.report_liability(uuid) from public, anon;
revoke all on function public.report_members(uuid, integer, integer, date, date) from public, anon;
grant execute on function public.report_sales(date, date, uuid) to authenticated;
grant execute on function public.report_checkins(date, date, uuid) to authenticated;
grant execute on function public.report_trend(uuid) to authenticated;
grant execute on function public.report_liability(uuid) to authenticated;
grant execute on function public.report_members(uuid, integer, integer, date, date) to authenticated;
