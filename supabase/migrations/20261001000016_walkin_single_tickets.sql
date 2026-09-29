-- =====================================================================
-- 原岩攀岩館 會員與櫃檯系統
-- 第 16 部分：非會員可以買單次票（老闆 2026-10-01 決定）
--   單次票（與租借）不需要會員就能結帳；次數票、年月票、課程仍要指定會員
--   非會員的單次票：結帳時每張票直接記一筆「入場」（沒有會員、沒有方案），
--   入場統計、今日入場都會算進去；訂單作廢或退費時這些入場自動取消
-- =====================================================================

-- 入場紀錄可以對應到訂單明細（非會員單次票用）
alter table public.checkins add column order_item_id uuid references public.order_items(id);
comment on column public.checkins.order_item_id is '非會員單次票：由哪一筆訂單明細產生';
create index on public.checkins (order_item_id) where order_item_id is not null;

alter table public.checkins drop constraint success_has_plan;
alter table public.checkins add constraint success_has_plan check (
  result <> 'success' or member_plan_id is not null or (member_id is null and order_item_id is not null)
);

create or replace function public.checkout(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.staff;
  v_branch public.branches;
  v_today date := app.today();
  v_member public.members;
  v_item jsonb;
  v_pay jsonb;
  pr public.products;
  v_qty int;
  v_line_disc int;
  v_subtotal int := 0;
  v_discount int := coalesce((p ->> 'discount_amount')::int, 0);
  v_total int;
  v_paid int := 0;
  v_order public.orders;
  v_item_id uuid;
  v_seq int;
  v_invoice_type public.invoice_type;
  v_carrier text;
  v_sales uuid := nullif(p ->> 'sales_staff_id', '')::uuid;
  i int;
begin
  s := app.require_staff(array['hq', 'manager', 'cashier']::public.staff_role[]);

  select * into v_branch from public.branches
    where id = case when s.role = 'hq' then (p ->> 'branch_id')::uuid else s.branch_id end;
  if v_branch.id is null or not v_branch.is_active then
    raise exception '分館不存在或已停止營運' using errcode = '22023';
  end if;
  if s.role = 'cashier' and app.day_closed(v_branch.id, v_today) then
    raise exception '今天已關帳，無法再結帳，請找店長重新開帳' using errcode = '42501';
  end if;

  if nullif(p ->> 'member_id', '') is not null then
    select * into v_member from public.members where id = (p ->> 'member_id')::uuid;
    if v_member.id is null then raise exception '找不到會員' using errcode = 'P0002'; end if;
    if v_member.status = 'inactive' then
      raise exception '此會員已停用' using errcode = '22023';
    end if;
  end if;

  if v_sales is not null and not exists (select 1 from public.staff where id = v_sales and status = 'active') then
    raise exception '業務代表不存在或已停用' using errcode = '22023';
  end if;

  if jsonb_typeof(p -> 'items') <> 'array' or jsonb_array_length(p -> 'items') = 0 then
    raise exception '購物車是空的' using errcode = '22023';
  end if;

  -- 1) 檢查每個品項並計算金額（價格以資料庫為準）
  for v_item in select * from jsonb_array_elements(p -> 'items') loop
    select * into pr from public.products where id = (v_item ->> 'product_id')::uuid;
    v_qty := coalesce((v_item ->> 'quantity')::int, 1);
    v_line_disc := coalesce((v_item ->> 'discount_amount')::int, 0);
    if pr.id is null then raise exception '找不到品項' using errcode = 'P0002'; end if;
    if pr.status <> 'on_sale'
       or (pr.sale_start is not null and v_today < pr.sale_start)
       or (pr.sale_end is not null and v_today > pr.sale_end) then
      raise exception '「%」目前未上架', pr.name using errcode = '22023';
    end if;
    if not pr.all_branches and not exists (
        select 1 from public.product_branches where product_id = pr.id and branch_id = v_branch.id) then
      raise exception '「%」不在本分館販售', pr.name using errcode = '22023';
    end if;
    -- 單次票與租借不需要會員（非會員直接買票入場）；次數票、年月票、課程要指定會員
    if pr.content_type not in ('rental', 'single') and v_member.id is null then
      raise exception '「%」需要指定會員', pr.name using errcode = '22023';
    end if;
    if v_qty < 1 or v_line_disc < 0 or v_line_disc > pr.price * v_qty then
      raise exception '「%」的數量或折扣不正確', pr.name using errcode = '22023';
    end if;
    v_subtotal := v_subtotal + pr.price * v_qty - v_line_disc;
  end loop;

  if v_discount < 0 or v_discount > v_subtotal then
    raise exception '折扣金額不正確' using errcode = '22023';
  end if;
  v_total := v_subtotal - v_discount;

  -- 2) 發票：預設使用會員的手機載具
  v_carrier := coalesce(nullif(upper(trim(p ->> 'invoice_carrier')), ''), v_member.carrier_code);
  v_invoice_type := coalesce(nullif(p ->> 'invoice_type', '')::public.invoice_type,
                             case when v_carrier is not null then 'carrier'::public.invoice_type else 'print'::public.invoice_type end);

  -- 3) 訂單編號：分館代碼-日期-流水號
  insert into app.order_counters (branch_id, business_date, last_no) values (v_branch.id, v_today, 1)
    on conflict (branch_id, business_date) do update set last_no = app.order_counters.last_no + 1
    returning last_no into v_seq;

  insert into public.orders (order_no, branch_id, business_date, member_id, cashier_staff_id,
      sales_staff_id, subtotal, discount_amount, discount_reason, total, invoice_type,
      invoice_carrier, invoice_tax_id, note)
  values (v_branch.code || '-' || to_char(v_today, 'YYYYMMDD') || '-' || lpad(v_seq::text, 4, '0'),
      v_branch.id, v_today, v_member.id, s.id, v_sales, v_subtotal, v_discount,
      nullif(p ->> 'discount_reason', ''), v_total, v_invoice_type,
      case when v_invoice_type = 'carrier' then v_carrier end,
      nullif(p ->> 'invoice_tax_id', ''), nullif(p ->> 'note', ''))
  returning * into v_order;

  -- 4) 明細與會員方案
  for v_item in select * from jsonb_array_elements(p -> 'items') loop
    select * into pr from public.products where id = (v_item ->> 'product_id')::uuid;
    v_qty := coalesce((v_item ->> 'quantity')::int, 1);
    v_line_disc := coalesce((v_item ->> 'discount_amount')::int, 0);

    insert into public.order_items (order_id, product_id, product_name, unit_price, quantity,
                                    discount_amount, line_total)
    values (v_order.id, pr.id, pr.name, pr.price, v_qty, v_line_disc, pr.price * v_qty - v_line_disc)
    returning id into v_item_id;

    if pr.content_type <> 'rental' and v_member.id is not null then
      for i in 1 .. v_qty loop
        insert into public.member_plans (member_id, product_id, order_item_id, name, content_type,
            total_count, remaining_count, start_date, end_date, usage_rule, slot_start, slot_end, branch_ids)
        values (v_member.id, pr.id, v_item_id, pr.name, pr.content_type,
            case when pr.content_type = 'days' then null else pr.quantity end,
            case when pr.content_type = 'days' then null else pr.quantity end,
            v_today,
            case pr.content_type
              when 'single' then v_today
              when 'days'   then v_today + pr.quantity - 1
              else case when pr.valid_days is not null then v_today + pr.valid_days - 1 end
            end,
            pr.usage_rule, pr.slot_start, pr.slot_end,
            case when pr.all_branches then null
                 else (select array_agg(branch_id) from public.product_branches where product_id = pr.id) end);
      end loop;
    elsif pr.content_type = 'single' then
      -- 非會員買單次票：每張票直接記一筆入場（入場統計算在「單次入場」；作廢或退費時自動取消）
      for i in 1 .. v_qty loop
        insert into public.checkins (member_id, member_plan_id, branch_id, business_date, method,
                                     staff_id, result, deducted, order_item_id)
        values (null, null, v_branch.id, v_today, 'counter', s.id, 'success', false, v_item_id);
      end loop;
    end if;
  end loop;

  -- 5) 付款：加總必須等於應收金額
  for v_pay in select * from jsonb_array_elements(coalesce(p -> 'payments', '[]'::jsonb)) loop
    if (v_pay ->> 'method') = 'cash' and (v_pay ->> 'cash_received') is not null
       and (v_pay ->> 'cash_received')::int < (v_pay ->> 'amount')::int then
      raise exception '收取現金不足' using errcode = '22023';
    end if;
    insert into public.payments (order_id, method, amount, cash_received, cash_change, line_pay_transaction_id)
    values (v_order.id, (v_pay ->> 'method')::public.payment_method, (v_pay ->> 'amount')::int,
            (v_pay ->> 'cash_received')::int,
            (v_pay ->> 'cash_received')::int - (v_pay ->> 'amount')::int,
            nullif(v_pay ->> 'line_pay_transaction_id', ''));
    v_paid := v_paid + (v_pay ->> 'amount')::int;
  end loop;

  if v_paid <> v_total then
    raise exception '付款金額 % 元與應收金額 % 元不符', v_paid, v_total using errcode = '22023';
  end if;

  return jsonb_build_object('order_id', v_order.id, 'order_no', v_order.order_no,
                            'total', v_total,
                            'change', (select coalesce(sum(cash_change), 0) from public.payments
                                       where order_id = v_order.id));
end $$;


-- 訂單作廢或退費時，取消非會員單次票產生的入場
create or replace function app.cancel_walkin_checkins() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.status = 'paid' and new.status in ('voided', 'refunded') then
    perform set_config('app.system_write', 'on', true);
    update public.checkins set cancelled_at = now(), cancelled_by = app.staff_id()
      where order_item_id in (select id from public.order_items where order_id = new.id)
        and cancelled_at is null;
  end if;
  return new;
end $$;
create trigger cancel_walkin_checkins after update of status on public.orders
  for each row execute function app.cancel_walkin_checkins();

-- 入場報表：非會員單次票算在「單次入場」（人數只算會員，非會員另列 walkins）
create or replace function public.report_checkins(p_from date, p_to date, p_branch_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_b uuid[];
begin
  v_b := app.report_branches(p_branch_id);
  perform app.report_check_range(p_from, p_to);

  return (
  with _rc as (
    -- 非會員單次票沒有方案：算「單次入場」，名稱用品項名
    select c.*, coalesce(p.content_type, 'single'::public.content_type) as content_type,
           coalesce(p.name, oi.product_name) as plan_name from public.checkins c
    left join public.member_plans p on p.id = c.member_plan_id
    left join public.order_items oi on oi.id = c.order_item_id
    where c.branch_id = any (v_b) and c.business_date between p_from and p_to and c.cancelled_at is null),
  ok as (select * from _rc where result = 'success'),
  entry as (select * from ok where content_type <> 'course')
  select jsonb_build_object(
    'summary', jsonb_build_object(
        'visits', (select count(*) from entry),
        'people', (select count(distinct member_id) from entry),
        'walkins', (select count(*) from entry where member_id is null),
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
