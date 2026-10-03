-- =====================================================================
-- 原岩攀岩館 會員與櫃檯系統
-- 第 22 部分：同事回饋修改（2026-10-02，老闆確認）；請先執行 0021
--   1. 商品與租借分開：已勾「管理庫存」的租借品項改成「商品」；商品、租借都不需要會員、不建立方案
--   2. 付款方式加「轉帳」（混合付款最多兩種）；關帳、營收報表、會計報表分開列轉帳
--   3. 發票加「捐贈」（愛心碼 3～7 碼）
--   4. 方案轉讓：品項可設定「可以轉讓」（課程預設不可）；轉讓時直接收「方案轉讓費」
--      （品項管理裡的「方案轉讓費」，金額可改；0 元就不收），轉讓與收費在同一個交易完成，費用記成一筆訂單
--   5. 系統用品項（例如方案轉讓費）不出現在結帳畫面，也不能從結帳販售
-- =====================================================================

-- 1. 商品
alter table public.products drop constraint single_rental_qty;
alter table public.products add constraint single_rental_qty
  check (content_type::text not in ('single', 'rental', 'goods') or quantity = 1);
alter table public.member_plans drop constraint if exists member_plans_content_type_check;
alter table public.member_plans add constraint member_plans_content_type_check
  check (content_type::text not in ('rental', 'goods'));
update public.products set content_type = 'goods' where content_type::text = 'rental' and track_stock;
comment on column public.products.track_stock is '管理庫存（商品）：結帳時自動扣庫存';

-- 4. 可以轉讓、系統用品項
alter table public.products
  add column transferable boolean not null default true,
  add column system_key text unique;
comment on column public.products.transferable is '買到的方案可以轉讓給其他會員（課程預設不可）';
comment on column public.products.system_key is '系統用品項（例：transfer_fee＝方案轉讓費），不出現在結帳畫面';
update public.products set transferable = false where content_type::text = 'course';

insert into public.products (name, category_id, price, content_type, quantity, usage_rule, all_branches, sort_order, system_key)
select '方案轉讓費', (select id from public.product_categories order by (name = '裝備租借') desc, sort_order limit 1),
       0, 'goods', 1, 'any', true, 9999, 'transfer_fee'
where not exists (select 1 from public.products where system_key = 'transfer_fee');

-- 3. 捐贈發票
alter table public.orders add column invoice_donate_code text;
alter table public.orders add constraint donation_code_required
  check (invoice_type::text <> 'donation' or invoice_donate_code ~ '^[0-9]{3,7}$');
comment on column public.orders.invoice_donate_code is '捐贈發票的愛心碼';
grant update (invoice_donate_code) on public.orders to authenticated;

-- 2. 關帳記錄轉帳金額
alter table public.daily_closings add column transfer_sales integer not null default 0;

-- 結帳：商品不需會員、捐贈發票、最多兩種付款、系統品項不能賣
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
  v_guests uuid[] := '{}';
  v_walkins int := 0;
  v_gi int := 0;
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
    if pr.system_key is not null then
      raise exception '「%」不能在結帳畫面販售', pr.name using errcode = '22023';
    end if;
    -- 單次票、商品、租借不需要會員（非會員簽安全守則後直接買票入場）；十次券、月票年票、課程要加入會員
    if pr.content_type::text not in ('rental', 'goods', 'single') and v_member.id is null then
      raise exception '「%」需要指定會員', pr.name using errcode = '22023';
    end if;
    if v_qty < 1 or v_line_disc < 0 or v_line_disc > pr.price * v_qty then
      raise exception '「%」的數量或折扣不正確', pr.name using errcode = '22023';
    end if;
    v_subtotal := v_subtotal + pr.price * v_qty - v_line_disc;
  end loop;

  -- 非會員的單次票：每張票都要對應一位已簽「目前版本」安全守則的訪客（老闆 2026-10-02）
  if v_member.id is null then
    select coalesce(sum(coalesce((it ->> 'quantity')::int, 1)), 0) into v_walkins
    from jsonb_array_elements(p -> 'items') it
    join public.products pp on pp.id = (it ->> 'product_id')::uuid
    where pp.content_type = 'single';
    if jsonb_typeof(p -> 'guests') = 'array' then
      select coalesce(array_agg(g::uuid), '{}') into v_guests from jsonb_array_elements_text(p -> 'guests') g;
    end if;
    if cardinality(v_guests) <> (select count(distinct g) from unnest(v_guests) g) then
      raise exception '同一位客人不能重複使用' using errcode = '22023';
    end if;
    if exists (select 1 from unnest(v_guests) g where not exists (
        select 1 from public.guest_waivers w where w.id = g and w.waiver_version_id = app.current_waiver_id())) then
      raise exception '有客人的安全守則不是目前版本，請重新簽署' using errcode = '22023';
    end if;
    if cardinality(v_guests) < v_walkins then
      raise exception '還有 % 位客人沒有簽安全守則', v_walkins - cardinality(v_guests) using errcode = '22023';
    end if;
    if cardinality(v_guests) > v_walkins then
      raise exception '簽安全守則的客人（% 位）比入場票（% 張）多', cardinality(v_guests), v_walkins using errcode = '22023';
    end if;
  end if;

  if v_discount < 0 or v_discount > v_subtotal then
    raise exception '折扣金額不正確' using errcode = '22023';
  end if;
  v_total := v_subtotal - v_discount;

  -- 2) 發票：預設使用會員的手機載具
  v_carrier := coalesce(nullif(upper(trim(p ->> 'invoice_carrier')), ''), v_member.carrier_code);
  v_invoice_type := coalesce(nullif(p ->> 'invoice_type', '')::public.invoice_type,
                             case when v_carrier is not null then 'carrier'::public.invoice_type else 'print'::public.invoice_type end);

  -- 發票捐贈：要有愛心碼（3～7 碼數字）
  if v_invoice_type::text = 'donation' and coalesce(p ->> 'invoice_donate_code', '') !~ '^[0-9]{3,7}$' then
    raise exception '捐贈發票請輸入 3～7 碼的愛心碼' using errcode = '22023';
  end if;
  -- 付款方式最多兩種（現金、LINE Pay、轉帳任選兩種）
  if (select count(distinct x ->> 'method') from jsonb_array_elements(coalesce(p -> 'payments', '[]'::jsonb)) x) > 2 then
    raise exception '混合付款最多兩種付款方式' using errcode = '22023';
  end if;

  -- 3) 訂單編號：分館代碼-日期-流水號
  insert into app.order_counters (branch_id, business_date, last_no) values (v_branch.id, v_today, 1)
    on conflict (branch_id, business_date) do update set last_no = app.order_counters.last_no + 1
    returning last_no into v_seq;

  insert into public.orders (order_no, branch_id, business_date, member_id, cashier_staff_id,
      sales_staff_id, subtotal, discount_amount, discount_reason, total, invoice_type,
      invoice_carrier, invoice_tax_id, note, invoice_donate_code)
  values (v_branch.code || '-' || to_char(v_today, 'YYYYMMDD') || '-' || lpad(v_seq::text, 4, '0'),
      v_branch.id, v_today, v_member.id, s.id, v_sales, v_subtotal, v_discount,
      nullif(p ->> 'discount_reason', ''), v_total, v_invoice_type,
      case when v_invoice_type = 'carrier' then v_carrier end,
      case when v_invoice_type::text = 'donation' then null else nullif(p ->> 'invoice_tax_id', '') end,
      nullif(p ->> 'note', ''),
      case when v_invoice_type::text = 'donation' then p ->> 'invoice_donate_code' end)
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

    if pr.content_type::text not in ('rental', 'goods') and v_member.id is not null then
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
        v_gi := v_gi + 1;
        insert into public.checkins (member_id, member_plan_id, branch_id, business_date, method,
                                     staff_id, result, deducted, order_item_id, guest_waiver_id)
        values (null, null, v_branch.id, v_today, 'counter', s.id, 'success', false, v_item_id, v_guests[v_gi]);
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

-- 關帳：加轉帳
create or replace function public.closing_preview(
  p_branch_id uuid default null, p_business_date date default null
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.staff; v_branch uuid; v_date date := coalesce(p_business_date, app.today());
begin
  s := app.require_staff(array['hq', 'manager', 'cashier']::public.staff_role[]);
  v_branch := case when s.role = 'hq' then p_branch_id else s.branch_id end;
  if v_branch is null then raise exception '請指定分館' using errcode = '22023'; end if;
  return (
    select jsonb_build_object(
      'branch_id', v_branch,
      'business_date', v_date,
      'petty_cash_default', (select petty_cash_default from public.branches where id = v_branch),
      'order_count', (select count(*) from public.orders
                      where branch_id = v_branch and business_date = v_date and status <> 'voided'),
      'cash_count', count(*) filter (where pm.method = 'cash'),
      'line_pay_count', count(*) filter (where pm.method = 'line_pay'),
      'transfer_count', count(*) filter (where pm.method::text = 'transfer'),
      'transfer_sales', coalesce(sum(pm.amount) filter (where pm.method::text = 'transfer'), 0),
      'transfer_refunds', (select coalesce(sum(amount), 0) from public.refunds
                           where branch_id = v_branch and business_date = v_date and method::text = 'transfer'),
      'cash_sales', coalesce(sum(pm.amount) filter (where pm.method = 'cash'), 0),
      'line_pay_sales', coalesce(sum(pm.amount) filter (where pm.method = 'line_pay'), 0),
      'cash_refunds', (select coalesce(sum(amount), 0) from public.refunds
                       where branch_id = v_branch and business_date = v_date and method = 'cash'),
      'line_pay_refunds', (select coalesce(sum(amount), 0) from public.refunds
                           where branch_id = v_branch and business_date = v_date and method = 'line_pay'),
      'checkin_count', (select count(*) from public.checkins
                        where branch_id = v_branch and business_date = v_date
                          and result = 'success' and cancelled_at is null),
      'item_sales', (select coalesce(jsonb_agg(x order by x.amount desc), '[]'::jsonb) from (
                       select oi.product_name as name, sum(oi.quantity)::int as quantity, sum(oi.line_total)::int as amount
                       from public.order_items oi join public.orders o on o.id = oi.order_id
                       where o.branch_id = v_branch and o.business_date = v_date and o.status <> 'voided'
                       group by oi.product_name) x),
      'is_closed', app.day_closed(v_branch, v_date))
    from public.payments pm
    join public.orders o on o.id = pm.order_id
    where o.branch_id = v_branch and o.business_date = v_date and o.status <> 'voided'
  );
end $$;

create or replace function public.close_day(
  p_petty_cash integer, p_counted_cash integer, p_difference_note text default null,
  p_branch_id uuid default null, p_business_date date default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.staff; v_branch uuid; v_date date := coalesce(p_business_date, app.today());
  pv jsonb; v_petty int; v_expected int; v_existing public.daily_closings; v_row public.daily_closings;
begin
  s := app.require_staff(array['hq', 'manager', 'cashier']::public.staff_role[]);
  v_branch := case when s.role = 'hq' then p_branch_id else s.branch_id end;
  if v_branch is null then raise exception '請指定分館' using errcode = '22023'; end if;
  if s.role = 'cashier' and v_date <> app.today() then
    raise exception '櫃檯只能關今天的帳' using errcode = '42501';
  end if;
  if v_date > app.today() then raise exception '不能關未來日期的帳' using errcode = '22023'; end if;

  pv := public.closing_preview(v_branch, v_date);
  v_petty := coalesce(p_petty_cash, (pv ->> 'petty_cash_default')::int);
  v_expected := v_petty + (pv ->> 'cash_sales')::int - (pv ->> 'cash_refunds')::int;

  if p_counted_cash <> v_expected and length(trim(coalesce(p_difference_note, ''))) = 0 then
    raise exception '實點金額與應有現金差 % 元，請填寫差額說明', p_counted_cash - v_expected
      using errcode = '22023';
  end if;

  select * into v_existing from public.daily_closings
    where branch_id = v_branch and business_date = v_date for update;
  if v_existing.id is not null and v_existing.reopened_at is null then
    raise exception '% 已經關帳過了', v_date using errcode = '22023';
  end if;

  if v_existing.id is null then
    insert into public.daily_closings (branch_id, business_date, petty_cash, cash_sales, line_pay_sales, transfer_sales,
        cash_refunds, expected_cash, counted_cash, difference, difference_note, closed_by)
    values (v_branch, v_date, v_petty, (pv ->> 'cash_sales')::int, (pv ->> 'line_pay_sales')::int, (pv ->> 'transfer_sales')::int,
        (pv ->> 'cash_refunds')::int, v_expected, p_counted_cash, p_counted_cash - v_expected,
        nullif(trim(p_difference_note), ''), s.id)
    returning * into v_row;
  else
    update public.daily_closings set petty_cash = v_petty,
        cash_sales = (pv ->> 'cash_sales')::int, line_pay_sales = (pv ->> 'line_pay_sales')::int,
        transfer_sales = (pv ->> 'transfer_sales')::int,
        cash_refunds = (pv ->> 'cash_refunds')::int, expected_cash = v_expected,
        counted_cash = p_counted_cash, difference = p_counted_cash - v_expected,
        difference_note = nullif(trim(p_difference_note), ''),
        closed_by = s.id, closed_at = now(), reopened_by = null, reopened_at = null
      where id = v_existing.id
      returning * into v_row;
    perform app.audit('closing.reclosed', 'daily_closings', v_row.id, v_branch,
                      to_jsonb(v_existing), to_jsonb(v_row));
  end if;
  return to_jsonb(v_row);
end $$;

-- 營收總覽：各分館加轉帳
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
          (select coalesce(sum(pm.amount), 0) from public.payments pm join public.orders o on o.id = pm.order_id
             where o.branch_id = b.id and o.business_date between p_from and p_to and o.status <> 'voided' and pm.method::text = 'transfer') as transfer,
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

-- 會計報表：加轉帳、捐贈愛心碼
create or replace function public.report_accounting(p_from date, p_to date, p_branch_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_b uuid[];
begin
  -- 會計帳號看全部分館（可指定分館）；其他人照報表權限（總部全部、店長自己分館）
  if exists (select 1 from public.staff where auth_user_id = auth.uid() and status = 'active' and role::text = 'accountant') then
    v_b := case when p_branch_id is not null then array[p_branch_id] else (select array_agg(id) from public.branches) end;
  else
    v_b := app.report_branches(p_branch_id);
  end if;
  perform app.report_check_range(p_from, p_to);
  if p_to - p_from > 61 then
    raise exception '會計明細一次最多兩個月，請分月查詢' using errcode = '22023';
  end if;

  return (
  with o as (
    select o.*, br.name as branch_name
    from public.orders o join public.branches br on br.id = o.branch_id
    where o.branch_id = any (v_b) and o.business_date between p_from and p_to),
  pay as (
    select p.order_id,
           coalesce(sum(p.amount) filter (where p.method = 'cash'), 0)::int as cash,
           coalesce(sum(p.amount) filter (where p.method = 'line_pay'), 0)::int as line_pay,
           coalesce(sum(p.amount) filter (where p.method::text = 'transfer'), 0)::int as transfer
    from public.payments p where p.order_id in (select id from o) group by p.order_id),
  sold as (select o.*, coalesce(pay.cash, 0) as cash, coalesce(pay.line_pay, 0) as line_pay, coalesce(pay.transfer, 0) as transfer
           from o left join pay on pay.order_id = o.id where o.status <> 'voided'),
  rf as (
    select r.*, br.name as branch_name, od.order_no, od.invoice_no, od.business_date as order_date
    from public.refunds r
    join public.branches br on br.id = r.branch_id
    join public.orders od on od.id = r.order_id
    where r.branch_id = any (v_b) and r.business_date between p_from and p_to),
  tot as (
    select coalesce((select sum(total) from sold), 0)::int as sales,
           coalesce((select sum(amount) from rf), 0)::int as refunds)
  select jsonb_build_object(
    'summary', (select jsonb_build_object(
        'orders', (select count(*) from sold),
        'sales', t.sales,
        'cash', (select coalesce(sum(cash), 0) from sold),
        'line_pay', (select coalesce(sum(line_pay), 0) from sold),
        'transfer', (select coalesce(sum(transfer), 0) from sold),
        'refunds', t.refunds,
        'refund_cash', (select coalesce(sum(amount), 0) from rf where method = 'cash'),
        'refund_line_pay', (select coalesce(sum(amount), 0) from rf where method = 'line_pay'),
        'refund_transfer', (select coalesce(sum(amount), 0) from rf where method::text = 'transfer'),
        'net', t.sales - t.refunds,
        -- 價格含 5% 營業稅：未稅＝含稅 ÷ 1.05（四捨五入），稅額＝含稅 − 未稅
        'net_untaxed', round((t.sales - t.refunds) / 1.05)::int,
        'tax', (t.sales - t.refunds) - round((t.sales - t.refunds) / 1.05)::int,
        'voided', (select count(*) from o where status = 'voided'),
        'voided_amount', (select coalesce(sum(total), 0) from o where status = 'voided'),
        'with_tax_id', (select count(*) from sold where invoice_tax_id is not null),
        'carrier', (select count(*) from sold where invoice_type = 'carrier'),
        'no_invoice_no', (select count(*) from sold where invoice_no is null or invoice_no = ''))
      from tot t),
    'by_day', (select coalesce(jsonb_agg(x order by x.date, x.branch), '[]'::jsonb) from (
        select d.date, d.branch,
               coalesce(s.sales, 0) as sales, coalesce(s.cash, 0) as cash, coalesce(s.line_pay, 0) as line_pay,
               coalesce(s.transfer, 0) as transfer,
               coalesce(s.orders, 0) as orders, coalesce(r.refunds, 0) as refunds,
               coalesce(s.sales, 0) - coalesce(r.refunds, 0) as net
        from (select business_date as date, branch_name as branch from sold
              union select business_date, branch_name from rf) d
        left join (select business_date, branch_name, sum(total)::int as sales, sum(cash)::int as cash,
                          sum(line_pay)::int as line_pay, sum(transfer)::int as transfer, count(*)::int as orders
                   from sold group by 1, 2) s on s.business_date = d.date and s.branch_name = d.branch
        left join (select business_date, branch_name, sum(amount)::int as refunds from rf group by 1, 2) r
               on r.business_date = d.date and r.branch_name = d.branch) x),
    'invoices', (select coalesce(jsonb_agg(x order by x.at), '[]'::jsonb) from (
        select o.business_date as date, o.created_at as at, o.branch_name as branch, o.order_no,
               o.invoice_no, o.invoice_type, o.invoice_carrier as carrier, o.invoice_tax_id as tax_id,
               (select string_agg(oi.product_name || case when oi.quantity > 1 then ' ×' || oi.quantity else '' end,
                                  '、' order by oi.created_at)
                from public.order_items oi where oi.order_id = o.id) as items,
               o.subtotal, o.discount_amount as discount, o.total,
               coalesce(pay.cash, 0) as cash, coalesce(pay.line_pay, 0) as line_pay, coalesce(pay.transfer, 0) as transfer,
               o.invoice_donate_code as donate_code, o.status, o.void_reason
        from o left join pay on pay.order_id = o.id) x),
    'refunds', (select coalesce(jsonb_agg(x order by x.at), '[]'::jsonb) from (
        select rf.business_date as date, rf.refunded_at as at, rf.branch_name as branch, rf.order_no,
               rf.invoice_no, rf.order_date, rf.amount, rf.method, rf.reason
        from rf) x)
  ));
end $$;

-- 方案轉讓（總部、店長）：可轉讓的方案才能轉；有設定轉讓費就同時收費、開一筆訂單
drop function if exists public.transfer_plan(uuid, uuid, text);
create or replace function public.transfer_plan(
  p_plan_id uuid, p_to_member_id uuid, p_reason text,
  p_payment_method public.payment_method default null, p_branch_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.staff; pl public.member_plans; fee public.products; v_to public.members;
  v_branch public.branches; v_today date := app.today(); v_seq int; v_order public.orders;
begin
  s := app.require_staff(array['hq', 'manager']::public.staff_role[]);
  pl := app.require_plan_manager(p_plan_id);
  if pl.status not in ('active', 'frozen') then raise exception '只有使用中或暫停中的方案可以轉讓' using errcode = '22023'; end if;
  if pl.product_id is not null and not (select transferable from public.products where id = pl.product_id) then
    raise exception '「%」不能轉讓', pl.name using errcode = '22023';
  end if;
  if pl.member_id = p_to_member_id then raise exception '不能轉讓給同一位會員' using errcode = '22023'; end if;
  select * into v_to from public.members where id = p_to_member_id and status = 'active';
  if v_to.id is null then
    raise exception '找不到要轉入的會員，或該會員不是正常狀態' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception '請填寫轉讓原因' using errcode = '22023'; end if;

  -- 轉讓費
  select * into fee from public.products where system_key = 'transfer_fee';
  if coalesce(fee.price, 0) > 0 then
    if p_payment_method is null then
      raise exception '請選擇轉讓費 % 元的付款方式', fee.price using errcode = '22023';
    end if;
    select * into v_branch from public.branches
      where id = case when s.role = 'hq' then p_branch_id else s.branch_id end;
    if v_branch.id is null then raise exception '請選擇收費的分館' using errcode = '22023'; end if;
    if app.day_closed(v_branch.id, v_today) then
      raise exception '%今天已關帳，請先重新開帳再收轉讓費', v_branch.name using errcode = '22023';
    end if;
    insert into app.order_counters (branch_id, business_date, last_no) values (v_branch.id, v_today, 1)
      on conflict (branch_id, business_date) do update set last_no = app.order_counters.last_no + 1
      returning last_no into v_seq;
    insert into public.orders (order_no, branch_id, business_date, member_id, cashier_staff_id, subtotal,
        discount_amount, total, invoice_type, note)
    values (v_branch.code || '-' || to_char(v_today, 'YYYYMMDD') || '-' || lpad(v_seq::text, 4, '0'),
        v_branch.id, v_today, pl.member_id, s.id, fee.price, 0, fee.price, 'print',
        '方案轉讓：' || pl.name || ' → ' || v_to.name)
    returning * into v_order;
    insert into public.order_items (order_id, product_id, product_name, unit_price, quantity, discount_amount, line_total)
    values (v_order.id, fee.id, fee.name, fee.price, 1, 0, fee.price);
    insert into public.payments (order_id, method, amount) values (v_order.id, p_payment_method, fee.price);
  end if;

  perform set_config('app.system_write', 'on', true);
  update public.member_plans
    set member_id = p_to_member_id,
        note = concat_ws('；', note, '由會員轉讓（' || v_today || '）')
    where id = pl.id;
  perform app.audit('member_plan.transferred', 'member_plans', pl.id, null, to_jsonb(pl),
                    jsonb_build_object('to_member_id', p_to_member_id, 'reason', p_reason,
                                       'fee', coalesce(fee.price, 0), 'order_no', v_order.order_no));
  return jsonb_build_object('fee', coalesce(fee.price, 0), 'order_no', v_order.order_no);
end $$;

revoke all on function public.transfer_plan(uuid, uuid, text, public.payment_method, uuid) from public, anon;
grant execute on function public.transfer_plan(uuid, uuid, text, public.payment_method, uuid) to authenticated;
