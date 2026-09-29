-- =====================================================================
-- 原岩攀岩館 會員與櫃檯系統
-- 第 14 部分：調整剩餘次數／堂數、異動紀錄查詢（老闆 2026-09-30 決定）
--   adjust_plan_count：店長以上可加減方案的可用次數或堂數（補償、贈送、多給收回），已使用次數不變，必填原因，寫入異動紀錄
--   audit_feed       ：總部後台「異動紀錄」頁（總部看全部，店長看自己分館）
--   新增品項也寫入異動紀錄
-- 課程使用期限沿用 products.valid_days（購買當天起算；後台品項編輯可設定）
-- =====================================================================

create or replace function public.adjust_plan_count(p_plan_id uuid, p_delta integer, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare pl public.member_plans; v_new integer; v_after public.member_plans;
begin
  pl := app.require_plan_manager(p_plan_id);
  if pl.content_type = 'days' then
    raise exception '年月票（天數型）沒有次數，請用「延期」' using errcode = '22023';
  end if;
  if pl.status = 'cancelled' then
    raise exception '已取消（退費或作廢）的方案不能調整' using errcode = '22023';
  end if;
  if p_delta is null or p_delta = 0 then
    raise exception '請輸入要增加或減少幾次' using errcode = '22023';
  end if;
  if abs(p_delta) > 100 then
    raise exception '一次最多調整 100 次' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception '請填寫調整原因' using errcode = '22023';
  end if;
  v_new := coalesce(pl.remaining_count, 0) + p_delta;
  if v_new < 0 then
    raise exception '剩餘只有 % 次，不能減少 % 次', coalesce(pl.remaining_count, 0), abs(p_delta) using errcode = '22023';
  end if;

  perform set_config('app.system_write', 'on', true);
  update public.member_plans
    set remaining_count = v_new,
        -- 總數跟著一起加減，「已使用」次數不變（扣錯要加回請用「取消入場」）
        total_count = coalesce(total_count, 0) + p_delta,
        status = case
          when status in ('active', 'used_up') and v_new = 0 then 'used_up'::public.plan_status
          when status = 'used_up' and v_new > 0 then
            case when end_date is not null and end_date < app.today() then 'expired'::public.plan_status
                 else 'active'::public.plan_status end
          else status end
    where id = pl.id
    returning * into v_after;

  perform app.audit('member_plan.adjusted', 'member_plans', pl.id, null, to_jsonb(pl),
                    to_jsonb(v_after) || jsonb_build_object('delta', p_delta, 'reason', p_reason));
  return jsonb_build_object('remaining_count', v_after.remaining_count, 'total_count', v_after.total_count,
                            'status', v_after.status);
end $$;

revoke all on function public.adjust_plan_count(uuid, integer, text) from public, anon;
grant execute on function public.adjust_plan_count(uuid, integer, text) to authenticated;

-- 新增品項也留紀錄
create or replace function app.audit_product_insert() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.audit('product.created', 'products', new.id, null, null, to_jsonb(new));
  return new;
end $$;
drop trigger if exists audit_insert on public.products;
create trigger audit_insert after insert on public.products
  for each row execute function app.audit_product_insert();

-- ---------------------------------------------------------------------
-- 異動紀錄查詢
--   p_group：plan 方案｜order 訂單與退費｜checkin 入場｜product 品項｜member 會員｜staff 員工與入場機｜closing 關帳
--   分館：紀錄本身的分館；沒有時用會員的主要分館（方案異動）
-- ---------------------------------------------------------------------
create or replace function public.audit_feed(
  p_from date, p_to date, p_branch_id uuid default null, p_group text default null,
  p_member_id uuid default null, p_staff_id uuid default null, p_limit integer default 300
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.staff; v_b uuid[];
begin
  s := app.require_staff(array['hq', 'manager']::public.staff_role[]);
  v_b := app.report_branches(p_branch_id);
  perform app.report_check_range(p_from, p_to);

  return (
  with a as (
    select l.*,
      -- 這筆紀錄是哪位會員的
      case l.table_name
        when 'member_plans' then coalesce((l.before ->> 'member_id')::uuid, (select mp.member_id from public.member_plans mp where mp.id = l.record_id))
        when 'members' then l.record_id
        when 'orders' then (select o.member_id from public.orders o where o.id = l.record_id)
        when 'refunds' then (select o.member_id from public.refunds r join public.orders o on o.id = r.order_id where r.id = l.record_id)
        when 'checkins' then (select c.member_id from public.checkins c where c.id = l.record_id)
      end as member_id
    from public.audit_logs l
    where l.occurred_at >= (p_from::timestamp at time zone 'Asia/Taipei')
      and l.occurred_at < ((p_to + 1)::timestamp at time zone 'Asia/Taipei')
      and (p_staff_id is null or l.staff_id = p_staff_id)
      and (p_group is null or case p_group
            when 'plan' then l.action like 'member_plan.%'
            when 'order' then l.action like 'order.%'
            when 'checkin' then l.action like 'checkin.%'
            when 'product' then l.action like 'product.%'
            when 'member' then l.action like 'member.%'
            when 'staff' then l.action like 'staff.%' or l.action like 'device.%'
            when 'closing' then l.action like 'closing.%'
            else true end)),
  b as (
    select a.*, m.name as member_name, m.member_no,
           coalesce(a.branch_id, m.home_branch_id) as eff_branch
    from a left join public.members m on m.id = a.member_id
    where (p_member_id is null or a.member_id = p_member_id
           or (a.table_name = 'member_plans' and (a.after ->> 'to_member_id')::uuid = p_member_id)))
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', b.id, 'at', b.occurred_at, 'action', b.action, 'table', b.table_name, 'record_id', b.record_id,
      'staff', st.name, 'branch', br.name,
      'member', case when b.member_id is not null then jsonb_build_object('id', b.member_id, 'name', b.member_name, 'no', b.member_no) end,
      'plan_name', case when b.table_name = 'member_plans' then (select mp.name from public.member_plans mp where mp.id = b.record_id) end,
      'product_name', case when b.table_name = 'products' then (select p.name from public.products p where p.id = b.record_id) end,
      'to_member', case when b.action = 'member_plan.transferred' then
          (select jsonb_build_object('name', m2.name, 'no', m2.member_no) from public.members m2 where m2.id = (b.after ->> 'to_member_id')::uuid) end,
      'before', b.before, 'after', b.after) order by b.occurred_at desc), '[]'::jsonb)
  from (select * from b
        -- 店長只看自己分館；總部可指定分館（沒有分館的紀錄，例如品項、員工，只在「全部分館」出現）
        where (b.eff_branch = any (v_b)) or (s.role = 'hq' and p_branch_id is null and b.eff_branch is null)
        order by b.occurred_at desc
        limit least(greatest(coalesce(p_limit, 300), 1), 2000)) b
  left join public.staff st on st.id = b.staff_id
  left join public.branches br on br.id = b.eff_branch
  );
end $$;

revoke all on function public.audit_feed(date, date, uuid, text, uuid, uuid, integer) from public, anon;
grant execute on function public.audit_feed(date, date, uuid, text, uuid, uuid, integer) to authenticated;
