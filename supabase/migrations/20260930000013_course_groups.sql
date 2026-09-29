-- =====================================================================
-- 原岩攀岩館 會員與櫃檯系統
-- 第 13 部分：課程統計分類與教練（老闆 2026-09-30 決定）
--   課程品名會因教練不同而不同 → 品項加「統計分類」與「教練」，報表依這兩個欄位加總
--   入場統計分三類：單次入場、票券入場、年月票入場；上課（課程）另外列
-- =====================================================================

alter table public.products
  add column report_group text check (report_group is null or length(trim(report_group)) > 0),
  add column coach text check (coach is null or length(trim(coach)) > 0);
comment on column public.products.report_group is '統計分類（課程用，例：一對一成人、兒童課）；報表依此加總，不同教練的品名歸在同一類';
comment on column public.products.coach is '教練姓名（課程用）；報表可看各教練的銷售與上課人次';

-- ---------------------------------------------------------------------
-- 入場報表：三類入場＋上課另計
--   summary.visits／people 只算入場（單次、票券、年月票），不含上課
--   heatmap 含上課（看館內尖峰用）
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
    where c.branch_id = any (v_b) and c.business_date between p_from and p_to and c.cancelled_at is null),
  ok as (select * from _rc where result = 'success'),
  entry as (select * from ok where content_type <> 'course')
  select jsonb_build_object(
    'summary', jsonb_build_object(
        'visits', (select count(*) from entry),
        'people', (select count(distinct member_id) from entry),
        'course_visits', (select count(*) from ok where content_type = 'course'),
        'course_people', (select count(distinct member_id) from ok where content_type = 'course'),
        'blocked', (select count(*) from _rc where result <> 'success'),
        'days', p_to - p_from + 1),
    -- 三類入場＋上課：single＝單次入場、punch＝票券入場、days＝年月票入場、course＝上課
    'by_type', (select coalesce(jsonb_agg(x order by x.sort), '[]'::jsonb) from (
        select content_type, count(*)::int as visits, count(distinct member_id)::int as people,
               case content_type when 'single' then 1 when 'punch' then 2 when 'days' then 3 else 4 end as sort
        from ok group by content_type) x),
    'by_plan', (select coalesce(jsonb_agg(x order by x.visits desc), '[]'::jsonb) from (
        select plan_name as name, content_type, count(*)::int as visits, count(distinct member_id)::int as people,
               count(*) filter (where deducted)::int as deducted
        from entry group by plan_name, content_type order by visits desc limit 30) x),
    'by_method', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select method, count(*)::int as visits from entry group by method) x),
    'blocked', (select coalesce(jsonb_agg(x order by x.count desc), '[]'::jsonb) from (
        select result, count(*)::int as count, count(distinct member_id)::int as people
        from _rc where result <> 'success' group by result) x),
    'heatmap', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select extract(isodow from business_date)::int as dow,
               extract(hour from checked_in_at at time zone 'Asia/Taipei')::int as hour,
               count(*)::int as visits
        from ok group by 1, 2) x),
    'day_kind', (select jsonb_build_object(
        'weekday_days', count(*) filter (where not app.is_holiday(d::date)),
        'holiday_days', count(*) filter (where app.is_holiday(d::date)),
        'weekday_visits', (select count(*) from entry where not app.is_holiday(business_date)),
        'holiday_visits', (select count(*) from entry where app.is_holiday(business_date)))
      from generate_series(p_from, p_to, interval '1 day') d)
  ));
end $$;

-- ---------------------------------------------------------------------
-- 課程報表：依統計分類、教練、品名；銷售（依銷售日）與上課人次（依上課日）
--   分類與教練以品項「目前」的設定歸類（改設定後，舊資料也會跟著歸到新分類）
-- ---------------------------------------------------------------------
create or replace function public.report_courses(p_from date, p_to date, p_branch_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_b uuid[];
begin
  v_b := app.report_branches(p_branch_id);
  perform app.report_check_range(p_from, p_to);

  return (
  with sold as (
    select pr.id as product_id, oi.product_name as name,
           coalesce(pr.report_group, '未分類') as grp, coalesce(pr.coach, '未填教練') as coach,
           oi.quantity, oi.line_total
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    join public.products pr on pr.id = oi.product_id
    where pr.content_type = 'course' and o.branch_id = any (v_b)
      and o.business_date between p_from and p_to and o.status <> 'voided'),
  attended as (
    select coalesce(pr.report_group, '未分類') as grp, coalesce(pr.coach, '未填教練') as coach,
           pr.name, c.member_id
    from public.checkins c
    join public.member_plans mp on mp.id = c.member_plan_id
    join public.products pr on pr.id = mp.product_id
    where mp.content_type = 'course' and c.result = 'success' and c.cancelled_at is null
      and c.branch_id = any (v_b) and c.business_date between p_from and p_to),
  keys_g as (select grp from sold union select grp from attended),
  keys_c as (select coach from sold union select coach from attended)
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'amount', (select coalesce(sum(line_total), 0) from sold),
      'quantity', (select coalesce(sum(quantity), 0) from sold),
      'visits', (select count(*) from attended),
      'people', (select count(distinct member_id) from attended)),
    'groups', (select coalesce(jsonb_agg(x order by x.amount desc, x.visits desc), '[]'::jsonb) from (
        select k.grp as name,
               coalesce((select sum(quantity) from sold s where s.grp = k.grp), 0)::int as quantity,
               coalesce((select sum(line_total) from sold s where s.grp = k.grp), 0)::int as amount,
               (select count(*) from attended a where a.grp = k.grp)::int as visits,
               (select count(distinct member_id) from attended a where a.grp = k.grp)::int as people
        from keys_g k) x),
    'coaches', (select coalesce(jsonb_agg(x order by x.amount desc, x.visits desc), '[]'::jsonb) from (
        select k.coach as name,
               coalesce((select sum(quantity) from sold s where s.coach = k.coach), 0)::int as quantity,
               coalesce((select sum(line_total) from sold s where s.coach = k.coach), 0)::int as amount,
               (select count(*) from attended a where a.coach = k.coach)::int as visits,
               (select count(distinct member_id) from attended a where a.coach = k.coach)::int as people
        from keys_c k) x),
    'items', (select coalesce(jsonb_agg(x order by x.grp, x.amount desc), '[]'::jsonb) from (
        select grp, coach, name, sum(quantity)::int as quantity, sum(line_total)::int as amount
        from sold group by grp, coach, name) x),
    -- 還沒設定統計分類或教練的課程品項（上架中）
    'unassigned', (select coalesce(jsonb_agg(jsonb_build_object('name', pr.name, 'no_group', pr.report_group is null,
                                                                'no_coach', pr.coach is null) order by pr.name), '[]'::jsonb)
                   from public.products pr
                   where pr.content_type = 'course' and pr.status = 'on_sale'
                     and (pr.report_group is null or pr.coach is null)
                     and (pr.all_branches or exists (select 1 from public.product_branches pb
                                                     where pb.product_id = pr.id and pb.branch_id = any (v_b))))
  ));
end $$;

revoke all on function public.report_courses(date, date, uuid) from public, anon;
grant execute on function public.report_courses(date, date, uuid) to authenticated;
