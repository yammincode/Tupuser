-- =====================================================================
-- 原岩攀岩館 會員與櫃檯系統
-- 第 20 部分：訪客安全守則、次數票共用、年月票綁本人（老闆 2026-10-02 決定）
--   1. 非會員（買單次票）簽安全守則：記錄姓名、手機、簽名（未成年加法定代理人），存在 guest_waivers；
--      下次來用手機號碼查到已簽目前版本就不用重簽；之後加入會員也不用再簽同一版
--      結帳時非會員的每張單次票都要對應一位已簽的訪客（入場紀錄記 guest_waiver_id）
--   2. 十次券、月票年票、課程要加入會員才能買（沿用）
--   3. 十次券可以分給別人用：每掃一次就扣一次（取消次數票「一天只扣一次」）；
--      單次票仍是當天可以出去再回來；同一個碼 5 秒內重複掃視為掃碼器連讀，不扣
--   4. 年月票綁本人：入場結果回傳「今天第幾次入場」，入場機成功畫面顯示大頭照、第 2 次以上會提示
-- =====================================================================

create table public.guest_waivers (
  id                       uuid primary key default gen_random_uuid(),
  name                     text not null check (length(trim(name)) between 1 and 50),
  phone                    text not null check (phone ~ '^\+8869[0-9]{8}$'),
  waiver_version_id        uuid not null references public.waiver_versions(id),
  signed_at                timestamptz not null default now(),
  branch_id                uuid references public.branches(id),
  staff_id                 uuid references public.staff(id),
  signature_path           text not null,
  agree_risk               boolean not null check (agree_risk),
  agree_health             boolean not null check (agree_health),
  agree_privacy            boolean not null check (agree_privacy),
  is_minor                 boolean not null default false,
  guardian_name            text,
  guardian_phone           text,
  guardian_relation        text,
  guardian_signature_path  text,
  constraint guest_guardian_required check (not is_minor or (
    guardian_name is not null and guardian_phone is not null and guardian_relation is not null
    and guardian_signature_path is not null))
);
comment on table public.guest_waivers is '非會員（訪客）簽的安全守則；只能新增，不能修改刪除';
create index on public.guest_waivers (phone, signed_at desc);

create trigger forbid_delete before delete on public.guest_waivers for each row execute function app.forbid_delete();
create or replace function app.forbid_update_guest_waiver() returns trigger
language plpgsql as $$
begin
  raise exception '安全守則簽署紀錄不能修改' using errcode = '42501';
end $$;
create trigger forbid_update before update on public.guest_waivers
  for each row execute function app.forbid_update_guest_waiver();

alter table public.guest_waivers enable row level security;
revoke all on public.guest_waivers from public, anon, authenticated;
grant select on public.guest_waivers to authenticated;
create policy guest_waivers_staff_read on public.guest_waivers for select to authenticated using (app.is_staff());

-- 非會員單次票的入場是哪一位訪客
alter table public.checkins add column guest_waiver_id uuid references public.guest_waivers(id);
comment on column public.checkins.guest_waiver_id is '非會員單次票：入場的訪客（簽過的安全守則）';

-- 訪客簽署（櫃檯平板）：簽名圖先上傳到 signatures/guests/，再呼叫這裡
create or replace function public.sign_guest_waiver(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.staff; v_id uuid; v_phone text; v_minor boolean := coalesce((p ->> 'is_minor')::boolean, false);
begin
  s := app.require_staff(array['hq', 'manager', 'cashier']::public.staff_role[]);
  if app.current_waiver_id() is null then
    raise exception '尚未建立同意書，請總部先建立' using errcode = '22023';
  end if;
  v_phone := regexp_replace(coalesce(p ->> 'phone', ''), '[^0-9]', '', 'g');
  if v_phone ~ '^09[0-9]{8}$' then v_phone := '+886' || substr(v_phone, 2);
  elsif v_phone ~ '^8869[0-9]{8}$' then v_phone := '+' || v_phone;
  else raise exception '手機號碼格式不正確（09 開頭共 10 碼）' using errcode = '22023';
  end if;
  if length(trim(coalesce(p ->> 'name', ''))) = 0 then
    raise exception '請填寫姓名' using errcode = '22023';
  end if;
  if not (coalesce((p ->> 'agree_risk')::boolean, false) and coalesce((p ->> 'agree_health')::boolean, false)
          and coalesce((p ->> 'agree_privacy')::boolean, false)) then
    raise exception '請勾選全部三個確認項目' using errcode = '22023';
  end if;
  if coalesce(p ->> 'signature_path', '') not like 'guests/%' then
    raise exception '請簽名' using errcode = '22023';
  end if;
  if v_minor and (coalesce(trim(p ->> 'guardian_name'), '') = '' or coalesce(trim(p ->> 'guardian_phone'), '') = ''
                  or coalesce(trim(p ->> 'guardian_relation'), '') = '' or coalesce(p ->> 'guardian_signature_path', '') not like 'guests/%') then
    raise exception '未滿 18 歲，請填寫法定代理人姓名、電話與關係，並由法定代理人一起簽名' using errcode = '22023';
  end if;
  insert into public.guest_waivers (name, phone, waiver_version_id, branch_id, staff_id, signature_path,
      agree_risk, agree_health, agree_privacy, is_minor, guardian_name, guardian_phone, guardian_relation,
      guardian_signature_path)
  values (trim(p ->> 'name'), v_phone, app.current_waiver_id(),
      case when s.role = 'hq' then nullif(p ->> 'branch_id', '')::uuid else s.branch_id end, s.id,
      p ->> 'signature_path', true, true, true, v_minor,
      case when v_minor then trim(p ->> 'guardian_name') end, case when v_minor then trim(p ->> 'guardian_phone') end,
      case when v_minor then trim(p ->> 'guardian_relation') end, case when v_minor then p ->> 'guardian_signature_path' end)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'name', trim(p ->> 'name'), 'phone', v_phone);
end $$;

-- 用手機號碼找訪客：回傳最近一次簽署，以及是否為目前版本
create or replace function public.find_guest_waiver(p_phone text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_phone text; w public.guest_waivers;
begin
  perform app.require_staff(array['hq', 'manager', 'cashier']::public.staff_role[]);
  v_phone := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  if v_phone ~ '^09[0-9]{8}$' then v_phone := '+886' || substr(v_phone, 2); else return null; end if;
  select * into w from public.guest_waivers where phone = v_phone
    order by (waiver_version_id = app.current_waiver_id()) desc, signed_at desc limit 1;
  if w.id is null then return null; end if;
  return jsonb_build_object('id', w.id, 'name', w.name, 'phone', w.phone, 'signed_at', w.signed_at,
                            'is_minor', w.is_minor, 'current', w.waiver_version_id = app.current_waiver_id(),
                            'member', (select jsonb_build_object('id', m.id, 'name', m.name) from public.members m where m.phone = v_phone));
end $$;

-- 會員是否已簽目前版本：會員自己簽過，或用同一支手機以訪客身分簽過目前版本（訪客加入會員不用重簽）
create or replace function app.has_current_waiver(p_member uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.current_waiver_id() is null
      or exists (select 1 from public.waiver_signatures
                 where member_id = p_member and waiver_version_id = app.current_waiver_id())
      or exists (select 1 from public.guest_waivers g join public.members m on m.phone = g.phone
                 where m.id = p_member and g.waiver_version_id = app.current_waiver_id())
$$;

-- 結帳：非會員單次票要對應訪客
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
    -- 單次票與租借不需要會員（非會員簽安全守則後直接買票入場）；十次券、月票年票、課程要加入會員
    if pr.content_type not in ('rental', 'single') and v_member.id is null then
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

-- 入場判斷：次數票每次都扣；回傳今天第幾次入場
create or replace function app.do_checkin(
  p_member uuid, p_branch uuid, p_method public.checkin_method,
  p_device uuid, p_staff uuid, p_plan uuid default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_today date := app.today();
  m public.members;
  pl public.member_plans;
  v_plan public.member_plans;
  v_blocked public.member_plans;
  v_reason public.checkin_result;
  v_result public.checkin_result;
  v_fallback public.checkin_result;
  v_deduct boolean := false;
  v_today_plan uuid;
  v_checkin uuid;
  v_paid_today boolean;
begin
  perform set_config('app.system_write', 'on', true);
  -- 鎖住會員，避免同一人同時在兩台機器入場造成重複扣次
  select * into m from public.members where id = p_member for update;
  if m.id is null then
    raise exception '找不到會員' using errcode = 'P0002';
  end if;

  -- 順便整理此會員已過期／用完的方案狀態
  update public.member_plans set status = 'expired'
    where member_id = m.id and status = 'active' and end_date < v_today;
  update public.member_plans set status = 'used_up'
    where member_id = m.id and status = 'active' and content_type <> 'days' and remaining_count <= 0;

  -- 今天是否已經用單次票入場（單次票當天可以出去再回來；次數票每次入場都扣，可以分給同行的人用）
  select exists (
    select 1 from public.checkins c join public.member_plans p on p.id = c.member_plan_id
    where c.member_id = m.id and c.business_date = v_today and c.result = 'success'
      and c.deducted and c.cancelled_at is null and p.content_type = 'single'
  ) into v_paid_today;

  if m.status <> 'active' then
    v_result := 'member_suspended';
  elsif not app.has_current_waiver(m.id) then
    v_result := 'waiver_required';
  elsif p_plan is not null then
    -- 指定方案（會員 App 方案頁的 QR、或櫃檯選的方案）
    select * into v_plan from public.member_plans where id = p_plan and member_id = m.id for update;
    if v_plan.id is null then
      raise exception '此方案不屬於這位會員' using errcode = '22023';
    end if;
    v_reason := app.plan_block_reason(v_plan, p_branch);
    if v_reason is null then
      v_result := 'success';
      -- 課程、次數票每次都扣；天數型不扣；單次票一天只扣一次
      v_deduct := v_plan.content_type in ('course', 'punch')
               or (v_plan.content_type = 'single' and not v_paid_today);
    elsif v_reason = 'no_remaining' and v_plan.content_type = 'single' and v_paid_today then
      v_result := 'success';  -- 今天已用單次票入場，出去再回來
    else
      v_result := v_reason;
      v_blocked := v_plan;
      v_plan := null;
    end if;
  else
    -- 今天已經用年月票或單次票入場過：沿用同一方案，不再扣次（次數票每次都扣，不沿用）
    select c.member_plan_id into v_today_plan from public.checkins c
      join public.member_plans p on p.id = c.member_plan_id
      where c.member_id = m.id and c.business_date = v_today and c.result = 'success'
        and c.cancelled_at is null and p.content_type in ('days', 'single')
      order by c.checked_in_at limit 1;
    if v_today_plan is not null then
      select * into v_plan from public.member_plans where id = v_today_plan;
      v_reason := app.plan_block_reason(v_plan, p_branch);
      if v_reason is null or v_reason = 'no_remaining' then
        v_result := 'success';
      else
        v_plan := null;
      end if;
    end if;

    -- 挑選方案：最快到期的優先（課程不自動使用）
    if v_result is null then
      for pl in
        select * from public.member_plans
        where member_id = m.id and content_type in ('single', 'punch', 'days')
          and status in ('active', 'used_up', 'expired')
        order by (status = 'active') desc, end_date asc nulls last, created_at asc
        for update
      loop
        v_reason := app.plan_block_reason(pl, p_branch);
        if v_reason is null then
          v_plan := pl; v_result := 'success';
          v_deduct := pl.content_type = 'punch' or (pl.content_type = 'single' and not v_paid_today);
          exit;
        end if;
        -- 記下最貼切的失敗原因：分館不符 > 時段不符 > 其他（以最新的方案為準）
        if v_reason = 'branch_not_allowed' then
          v_fallback := 'branch_not_allowed'; v_blocked := pl;
        elsif v_reason = 'not_allowed_now' and v_fallback is distinct from 'branch_not_allowed' then
          v_fallback := 'not_allowed_now'; v_blocked := pl;
        end if;
      end loop;

      if v_result is null then
        if v_fallback is null then
          select * into v_blocked from public.member_plans p
          where p.member_id = m.id and p.content_type in ('single', 'punch', 'days')
            and p.status in ('active', 'used_up', 'expired')
          order by p.created_at desc limit 1;
          if v_blocked.id is not null then
            v_fallback := app.plan_block_reason(v_blocked, p_branch);
          end if;
        end if;
        v_result := coalesce(v_fallback, 'no_valid_plan');
      end if;
    end if;
  end if;

  if v_result = 'success' and v_deduct then
    update public.member_plans
      set remaining_count = remaining_count - 1,
          status = case when remaining_count - 1 <= 0 then 'used_up'::public.plan_status else status end
      where id = v_plan.id
      returning * into v_plan;
  end if;

  insert into public.checkins (member_id, member_plan_id, branch_id, business_date, method,
                               device_id, staff_id, result, deducted)
  values (m.id, case when v_result = 'success' then v_plan.id end, p_branch, v_today, p_method,
          p_device, p_staff, v_result, v_result = 'success' and v_deduct)
  returning id into v_checkin;

  return jsonb_build_object(
    'result', v_result,
    'screen', app.checkin_screen(v_result),
    'message', app.checkin_message(v_result),
    'checkin_id', v_checkin,
    'deducted', v_result = 'success' and v_deduct,
    -- 今天第幾次成功入場（年月票第 2 次以上，入場機與今日名單會提示）
    'entries_today', (select count(*) from public.checkins c where c.member_id = m.id and c.business_date = v_today
                      and c.result = 'success' and c.cancelled_at is null),
    'member', jsonb_build_object('id', m.id, 'member_no', m.member_no, 'name', m.name,
                                 'avatar_path', m.avatar_path),
    'plan', case when v_result = 'success' then jsonb_build_object(
              'id', v_plan.id, 'name', v_plan.name, 'content_type', v_plan.content_type,
              'remaining_count', v_plan.remaining_count, 'end_date', v_plan.end_date) end,
    -- 被擋下時，是哪個方案造成的（入場機顯示「你的月票已於 9/14 到期」用）
    'blocked_plan', case when v_result <> 'success' and v_blocked.id is not null then jsonb_build_object(
              'id', v_blocked.id, 'name', v_blocked.name, 'content_type', v_blocked.content_type,
              'remaining_count', v_blocked.remaining_count, 'end_date', v_blocked.end_date) end
  );
end $$;

-- 入場機：次數票同一個碼隔 5 秒再掃，視為同行的下一位
create or replace function public.kiosk_checkin(p_qr text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d public.devices;
  q record;
  v_prev jsonb;
  v_res jsonb;
  v_prev_at timestamptz;
  v_prev_type public.content_type;
  v_prev_plan uuid;
begin
  d := app.device();
  if d.id is null then
    raise exception '此裝置未授權為入場機' using errcode = '42501';
  end if;
  update public.devices set last_seen_at = now() where id = d.id;

  select * into q from app.parse_member_qr(p_qr);
  if (q.member).id is not null then
    perform 1 from app.member_qr_keys where member_id = (q.member).id for update;
  end if;

  if q.matched_step is not null and q.matched_step <= q.last_used_step then
    -- 同一個碼再次被掃：若剛剛才在這裡成功入場（重複刷），直接回覆成功；否則視為截圖盜用
    select jsonb_build_object('checkin_id', c.id, 'plan', jsonb_build_object(
             'id', p.id, 'name', p.name, 'content_type', p.content_type,
             'remaining_count', p.remaining_count, 'end_date', p.end_date)),
           c.checked_in_at, p.content_type, p.id
      into v_prev, v_prev_at, v_prev_type, v_prev_plan
      from public.checkins c left join public.member_plans p on p.id = c.member_plan_id
      where c.member_id = (q.member).id and c.branch_id = d.branch_id and c.result = 'success'
        and c.cancelled_at is null and c.checked_in_at > now() - interval '90 seconds'
      order by c.checked_in_at desc limit 1;
    -- 次數票可以分給同行的人：同一個碼隔 5 秒以上再掃，視為下一位入場，再扣一次
    -- （5 秒內的重複是掃碼器連讀，不扣）
    if v_prev is not null and v_prev_type = 'punch' and v_prev_at < now() - interval '5 seconds' then
      v_res := app.do_checkin((q.member).id, d.branch_id, 'kiosk', d.id, null, v_prev_plan);
      return v_res
        || jsonb_build_object('branch', jsonb_build_object('name', (select name from public.branches where id = d.branch_id),
                                                          'kiosk_volume', (select kiosk_volume from public.branches where id = d.branch_id)));
    end if;
    if v_prev is not null then
      return jsonb_build_object('result', 'success', 'screen', 'ok', 'message', app.checkin_message('success'),
        'repeated', true, 'checkin_id', v_prev ->> 'checkin_id', 'deducted', false, 'plan', v_prev -> 'plan',
        'member', jsonb_build_object('id', (q.member).id, 'member_no', (q.member).member_no,
                                     'name', (q.member).name, 'avatar_path', (q.member).avatar_path));
    end if;
    q.matched_step := null;
  end if;

  if q.matched_step is null then
    insert into public.checkins (member_id, branch_id, business_date, method, device_id, result)
    values ((q.member).id, d.branch_id, app.today(), 'kiosk', d.id, 'qr_invalid');
    return jsonb_build_object('result', 'qr_invalid', 'screen', 'invalid', 'message', app.checkin_message('qr_invalid'));
  end if;

  -- QR 指定的方案若不屬於這位會員，視為 QR 失效
  if q.plan_id is not null and not exists (
      select 1 from public.member_plans where id = q.plan_id and member_id = (q.member).id) then
    insert into public.checkins (member_id, branch_id, business_date, method, device_id, result)
    values ((q.member).id, d.branch_id, app.today(), 'kiosk', d.id, 'qr_invalid');
    return jsonb_build_object('result', 'qr_invalid', 'screen', 'invalid', 'message', app.checkin_message('qr_invalid'));
  end if;

  v_res := app.do_checkin((q.member).id, d.branch_id, 'kiosk', d.id, null, q.plan_id);
  if v_res ->> 'result' = 'success' then
    update app.member_qr_keys set last_used_step = q.matched_step where member_id = (q.member).id;
  end if;
  return v_res
    || jsonb_build_object('branch', jsonb_build_object('name', (select name from public.branches where id = d.branch_id),
                                                      'kiosk_volume', (select kiosk_volume from public.branches where id = d.branch_id)));
end $$;

revoke all on function public.sign_guest_waiver(jsonb) from public, anon;
revoke all on function public.find_guest_waiver(text) from public, anon;
grant execute on function public.sign_guest_waiver(jsonb) to authenticated;
grant execute on function public.find_guest_waiver(text) to authenticated;
