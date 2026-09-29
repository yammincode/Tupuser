-- =====================================================================
-- 原岩攀岩館 會員與櫃檯系統
-- 第 10 部分：營收報表（總部看全部分館；店長只看自己分館）
-- =====================================================================

create or replace function public.sales_report(
  p_from date, p_to date, p_branch_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.staff; v_branches uuid[];
begin
  s := app.require_staff(array['hq', 'manager']::public.staff_role[]);
  if p_from is null or p_to is null or p_from > p_to then
    raise exception '請選擇正確的日期區間' using errcode = '22023';
  end if;
  if p_to - p_from > 366 then
    raise exception '日期區間最多一年' using errcode = '22023';
  end if;
  -- 店長只能看自己分館
  if s.role = 'manager' then
    v_branches := array[s.branch_id];
  elsif p_branch_id is not null then
    v_branches := array[p_branch_id];
  else
    select array_agg(id) into v_branches from public.branches;
  end if;

  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    -- 各分館
    'by_branch', (
      select coalesce(jsonb_agg(x order by x.sort_order), '[]'::jsonb) from (
        select b.id as branch_id, b.name, b.sort_order,
          (select count(*) from public.orders o where o.branch_id = b.id and o.business_date between p_from and p_to and o.status <> 'voided') as orders,
          (select coalesce(sum(pm.amount), 0) from public.payments pm join public.orders o on o.id = pm.order_id
             where o.branch_id = b.id and o.business_date between p_from and p_to and o.status <> 'voided' and pm.method = 'cash') as cash,
          (select coalesce(sum(pm.amount), 0) from public.payments pm join public.orders o on o.id = pm.order_id
             where o.branch_id = b.id and o.business_date between p_from and p_to and o.status <> 'voided' and pm.method = 'line_pay') as line_pay,
          (select coalesce(sum(r.amount), 0) from public.refunds r where r.branch_id = b.id and r.business_date between p_from and p_to) as refunds,
          (select count(*) from public.checkins c where c.branch_id = b.id and c.business_date between p_from and p_to
             and c.result = 'success' and c.cancelled_at is null) as checkins,
          (select count(*) from public.members m where m.home_branch_id = b.id
             and (m.created_at at time zone 'Asia/Taipei')::date between p_from and p_to) as new_members
        from public.branches b where b.id = any (v_branches)
      ) x),
    -- 每日營收（已扣退款）
    'by_day', (
      select coalesce(jsonb_agg(jsonb_build_object('date', d::date, 'sales', coalesce(sa.amt, 0), 'refunds', coalesce(rf.amt, 0),
                                                   'net', coalesce(sa.amt, 0) - coalesce(rf.amt, 0)) order by d), '[]'::jsonb)
      from generate_series(p_from, p_to, interval '1 day') d
      left join (select o.business_date, sum(o.total) amt from public.orders o
                 where o.branch_id = any (v_branches) and o.business_date between p_from and p_to and o.status <> 'voided'
                 group by 1) sa on sa.business_date = d::date
      left join (select r.business_date, sum(r.amount) amt from public.refunds r
                 where r.branch_id = any (v_branches) and r.business_date between p_from and p_to
                 group by 1) rf on rf.business_date = d::date),
    -- 品項排行
    'top_items', (
      select coalesce(jsonb_agg(x order by x.amount desc), '[]'::jsonb) from (
        select oi.product_name as name, sum(oi.quantity)::int as quantity, sum(oi.line_total)::int as amount
        from public.order_items oi join public.orders o on o.id = oi.order_id
        where o.branch_id = any (v_branches) and o.business_date between p_from and p_to and o.status <> 'voided'
        group by oi.product_name order by amount desc limit 20) x),
    -- 關帳差額
    'closings', (
      select coalesce(jsonb_agg(jsonb_build_object('date', c.business_date, 'branch', b.name, 'difference', c.difference,
                                                   'note', c.difference_note, 'reopened', c.reopened_at is not null)
                                order by c.business_date desc, b.sort_order), '[]'::jsonb)
      from public.daily_closings c join public.branches b on b.id = c.branch_id
      where c.branch_id = any (v_branches) and c.business_date between p_from and p_to)
  );
end $$;

revoke all on function public.sales_report(date, date, uuid) from public, anon;
grant execute on function public.sales_report(date, date, uuid) to authenticated;
