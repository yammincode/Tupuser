-- =====================================================================
-- 原岩攀岩館 會員與櫃檯系統
-- 第 11 部分：會員 App（手機）
--   my_app_home()   ：首頁資料（姓名、是否要簽同意書、方案、目前方案、本月入場次數、伺服器時間）
--   my_checkins()   ：入場紀錄（含每次入場後剩幾次）
--   會員改成只能透過以上函式讀取自己的方案（看不到方案上的內部備註）
-- =====================================================================

-- 會員讀方案改走函式：資料表只開放給員工
drop policy if exists member_plans_read on public.member_plans;
create policy member_plans_read on public.member_plans for select to authenticated
  using (app.is_staff());

-- 方案給會員看的欄位
create or replace function app.member_plan_json(p public.member_plans) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.name, 'content_type', p.content_type,
    'total_count', p.total_count, 'remaining_count', p.remaining_count,
    'start_date', p.start_date, 'end_date', p.end_date,
    'usage_rule', p.usage_rule, 'slot_start', p.slot_start, 'slot_end', p.slot_end,
    'status', p.status, 'frozen_at', p.frozen_at,
    -- 適用分館：null = 全分館
    'branches', case when p.branch_ids is null or cardinality(p.branch_ids) = 0 then null else
      (select jsonb_agg(b.name order by b.sort_order) from public.branches b where b.id = any (p.branch_ids)) end,
    'category', (select jsonb_build_object('name', c.name, 'bg', c.bg_color, 'fg', c.text_color)
                 from public.products pr join public.product_categories c on c.id = pr.category_id
                 where pr.id = p.product_id)
  )
$$;

create or replace function public.my_app_home() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  m public.members;
  v_today date := app.today();
  v_current uuid;
begin
  select * into m from public.members where id = app.member_id();
  if m.id is null then
    raise exception '這支手機還沒有註冊成會員' using errcode = '42501';
  end if;

  -- 目前方案：今天已經用過的方案優先；否則挑最快到期、現在能用的（和入場機自動挑選的順序一樣，課程不自動使用）
  select c.member_plan_id into v_current from public.checkins c
    join public.member_plans p on p.id = c.member_plan_id
    where c.member_id = m.id and c.business_date = v_today and c.result = 'success'
      and c.cancelled_at is null and p.content_type <> 'course' and p.status = 'active'
    order by c.checked_in_at limit 1;
  if v_current is null then
    select p.id into v_current from public.member_plans p
      where p.member_id = m.id and p.status = 'active' and p.content_type in ('single', 'punch', 'days')
        and (p.start_date is null or p.start_date <= v_today)
        and (p.end_date is null or p.end_date >= v_today)
        and (p.content_type = 'days' or p.remaining_count > 0)
      order by p.end_date asc nulls last, p.created_at asc
      limit 1;
  end if;

  return jsonb_build_object(
    'member', jsonb_build_object(
      'id', m.id, 'name', m.name, 'member_no', m.member_no, 'status', m.status,
      'is_minor', (m.birthday + interval '18 years')::date > v_today,
      'waiver_required', not app.has_current_waiver(m.id)),
    'current_plan_id', v_current,
    -- 使用中與暫停中的方案
    'plans', (select coalesce(jsonb_agg(app.member_plan_json(p)
                order by (p.id = v_current) desc, p.end_date asc nulls last, p.created_at), '[]'::jsonb)
              from public.member_plans p
              where p.member_id = m.id and p.status in ('active', 'frozen')),
    -- 最近結束的方案（最多 5 個）
    'past_plans', (select coalesce(jsonb_agg(app.member_plan_json(x) order by x.updated_at desc), '[]'::jsonb)
                   from (select * from public.member_plans p
                         where p.member_id = m.id and p.status in ('used_up', 'expired')
                         order by p.updated_at desc limit 5) x),
    'month_checkins', (select count(*) from public.checkins c
                       where c.member_id = m.id and c.result = 'success' and c.cancelled_at is null
                         and c.business_date >= date_trunc('month', v_today)::date),
    -- 手機時間不準時，App 用伺服器時間算入場碼
    'server_time', floor(extract(epoch from clock_timestamp()) * 1000)
  );
end $$;

-- 入場紀錄（只列成功入場），附帶這次入場後該方案剩幾次
create or replace function public.my_checkins(p_limit integer default 50) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(x order by x.at desc), '[]'::jsonb) from (
    select c.checked_in_at as at, b.name as branch, p.name as plan_name, p.content_type,
           c.deducted, c.method,
           case when p.content_type <> 'days' then
             p.remaining_count + (select count(*) from public.checkins l
                                  where l.member_plan_id = c.member_plan_id and l.deducted
                                    and l.cancelled_at is null and l.checked_in_at > c.checked_in_at)
           end as remaining_after
    from public.checkins c
    join public.branches b on b.id = c.branch_id
    join public.member_plans p on p.id = c.member_plan_id
    where c.member_id = app.member_id() and c.result = 'success' and c.cancelled_at is null
    order by c.checked_in_at desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
  ) x
$$;

revoke all on function app.member_plan_json(public.member_plans) from public, anon, authenticated;
revoke all on function public.my_app_home() from public, anon;
revoke all on function public.my_checkins(integer) from public, anon;
grant execute on function public.my_app_home() to authenticated;
grant execute on function public.my_checkins(integer) to authenticated;
