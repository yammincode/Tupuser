-- =====================================================================
-- 原岩攀岩館 會員與櫃檯系統
-- 第 24 部分：同事回饋第三批（老闆 2026-10-04 確認）
--   1. 品項可以手動排序（總部）：set_product_order
--   2. 轉讓費改在櫃檯結帳收（開發票）；後台轉讓時選那筆訂單（或填原因免收）
--   3. 單店票改全店通：櫃檯結帳收「升級全店通」差價，後台轉換時選那筆訂單；保留到期日與剩餘次數
--      products.fee_kind：transfer_fee 轉讓費／upgrade_fee 升級全店通差價（可建立多個，價格不同）
--      plan_fee_links：哪一筆訂單已經用在哪個方案（一筆只能用一次）
--   4. 暫停可以指定期間：開始暫停日、結束暫停日（可先空白），可補登過去的日期；
--      到期日依暫停天數延長；每天 00:01 自動把到了日期的方案切換成暫停／恢復（pg_cron）
--   5. 新角色「庫存管理」（inventory）：所有分館的庫存（進貨、盤點、調撥、報廢、確認盤點、新增商品），
--      看不到營收、會員、訂單；和會計一樣被排除在 app.staff_id() 等身分函式之外
--   6. 櫃檯庫存頁可以新增商品（店長限自己分館、庫存管理、總部）：create_stock_product
--   7. 調撥可以「調入」：店長可以從別館調到自己分館
-- 需先執行第 23 部分（新增角色值）
-- =====================================================================

-- ---------------------------------------------------------------------
-- 5. 庫存管理角色
-- ---------------------------------------------------------------------
alter table public.staff drop constraint staff_branch_required;
alter table public.staff add constraint staff_branch_required
  check (role::text in ('hq', 'accountant', 'inventory') or branch_id is not null);

create or replace function app.staff_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from public.staff where auth_user_id = auth.uid() and status = 'active' and role::text not in ('accountant', 'inventory')
$$;

create or replace function app.staff_role() returns public.staff_role
language sql stable security definer set search_path = public, pg_temp as $$
  select role from public.staff where auth_user_id = auth.uid() and status = 'active' and role::text not in ('accountant', 'inventory')
$$;

create or replace function app.staff_branch_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select branch_id from public.staff where auth_user_id = auth.uid() and status = 'active' and role::text not in ('accountant', 'inventory')
$$;

-- 異動紀錄記下是誰做的（庫存管理也要記）
create or replace function app.audit(
  p_action text, p_table text, p_record uuid, p_branch uuid, p_before jsonb, p_after jsonb
) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.audit_logs (staff_id, branch_id, action, table_name, record_id, before, after)
  values (coalesce(app.staff_id(),
                   (select id from public.staff where auth_user_id = auth.uid() and status = 'active' and role::text = 'inventory')),
          p_branch, p_action, p_table, p_record, p_before, p_after)
$$;

-- 可以處理庫存的員工（總部、店長、櫃檯、庫存管理）
create or replace function app.stock_staff() returns public.staff
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.staff;
begin
  select * into s from public.staff where auth_user_id = auth.uid() and status = 'active';
  if s.id is null then raise exception '請先以員工帳號登入' using errcode = '42501'; end if;
  if s.role::text not in ('hq', 'manager', 'cashier', 'inventory') then
    raise exception '您的權限不足以執行此操作' using errcode = '42501';
  end if;
  return s;
end $$;

-- 能不能管理這間分館的庫存（調撥、報廢、確認盤點、新增商品）：總部、庫存管理、該分館店長
create or replace function app.can_manage_stock(p_branch uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.staff where auth_user_id = auth.uid() and status = 'active'
                   and (role::text in ('hq', 'inventory') or (role = 'manager' and branch_id = p_branch)))
$$;

-- 看得到哪些分館的庫存：總部、庫存管理＝全部（可指定）；其他人＝自己分館
create or replace function app.stock_branches(p_branch uuid, p_active_only boolean) returns uuid[]
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.staff; v uuid[];
begin
  s := app.stock_staff();
  if s.role::text not in ('hq', 'inventory') then return array[s.branch_id]; end if;
  if p_branch is not null then return array[p_branch]; end if;
  select array_agg(id order by sort_order) into v from public.branches where is_active or not p_active_only;
  return v;
end $$;

-- 進貨、盤點：這間分館的員工；總部、庫存管理不限分館
create or replace function app.require_branch_staff(p_branch uuid) returns public.staff
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.staff;
begin
  s := app.stock_staff();
  if p_branch is null or not exists (select 1 from public.branches where id = p_branch) then
    raise exception '請選擇分館' using errcode = '22023';
  end if;
  if s.role::text not in ('hq', 'inventory') and s.branch_id <> p_branch then
    raise exception '只能操作自己分館的庫存' using errcode = '42501';
  end if;
  return s;
end $$;

-- 調撥（可調出也可調入）、報廢、確認盤點、庫存總覽、異動明細
create or replace function public.stock_transfer(p_from uuid, p_to uuid, p_items jsonb, p_note text default null)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.staff; it jsonb; pr public.products; q integer; n integer := 0;
begin
  s := app.stock_staff();
  if p_from is null or p_to is null or p_to = p_from
     or (select count(*) from public.branches where id in (p_from, p_to)) <> 2 then
    raise exception '請選擇調出與調入的分館' using errcode = '22023';
  end if;
  -- 店長可以「從自己分館調出」或「從別館調入自己分館」；庫存管理與總部不限
  if not (app.can_manage_stock(p_from) or app.can_manage_stock(p_to)) then
    raise exception '只能調出或調入自己的分館' using errcode = '42501';
  end if;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    pr := app.require_stock_product((it ->> 'product_id')::uuid);
    q := coalesce((it ->> 'quantity')::int, 0);
    if q < 1 then raise exception '「%」的調撥數量不正確', pr.name using errcode = '22023'; end if;
    insert into public.stock_movements (branch_id, product_id, kind, quantity, business_date, note, staff_id)
    values (p_from, pr.id, 'transfer_out', -q, app.today(), nullif(trim(p_note), ''), s.id),
           (p_to, pr.id, 'transfer_in', q, app.today(), nullif(trim(p_note), ''), s.id);
    n := n + 1;
  end loop;
  if n = 0 then raise exception '請輸入調撥的商品與數量' using errcode = '22023'; end if;
  perform app.audit('stock.transferred', 'stock_movements', null, p_from, null,
                    jsonb_build_object('to_branch_id', p_to, 'items', p_items, 'note', p_note));
  return n;
end $$;

create or replace function public.stock_scrap(p_branch_id uuid, p_items jsonb, p_reason text)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.staff; it jsonb; pr public.products; q integer; n integer := 0;
begin
  s := app.stock_staff();
  if not app.can_manage_stock(p_branch_id) then raise exception '只能處理自己分館的庫存' using errcode = '42501'; end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception '請填寫報廢原因' using errcode = '22023'; end if;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    pr := app.require_stock_product((it ->> 'product_id')::uuid);
    q := coalesce((it ->> 'quantity')::int, 0);
    if q < 1 then raise exception '「%」的報廢數量不正確', pr.name using errcode = '22023'; end if;
    insert into public.stock_movements (branch_id, product_id, kind, quantity, business_date, note, staff_id)
    values (p_branch_id, pr.id, 'scrap', -q, app.today(), p_reason, s.id);
    n := n + 1;
  end loop;
  if n = 0 then raise exception '請輸入報廢的商品與數量' using errcode = '22023'; end if;
  perform app.audit('stock.scrapped', 'stock_movements', null, p_branch_id, null,
                    jsonb_build_object('items', p_items, 'reason', p_reason));
  return n;
end $$;

create or replace function public.stocktake_decide(p_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.staff; t public.stocktakes;
begin
  s := app.stock_staff();
  select * into t from public.stocktakes where id = p_id for update;
  if t.id is null then raise exception '找不到盤點' using errcode = 'P0002'; end if;
  if not app.can_manage_stock(t.branch_id) then raise exception '只能確認自己分館的盤點' using errcode = '42501'; end if;
  if t.status <> 'pending' then raise exception '這筆盤點已經處理過了' using errcode = '22023'; end if;
  if not p_approve and length(trim(coalesce(p_note, ''))) = 0 then
    raise exception '退回盤點請填寫原因' using errcode = '22023';
  end if;
  update public.stocktakes set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = s.id, decided_at = now(), decide_note = nullif(trim(p_note), '')
    where id = t.id;
  if p_approve then
    insert into public.stock_movements (branch_id, product_id, kind, quantity, business_date, stocktake_id, note, staff_id)
    select t.branch_id, l.product_id, 'adjust', l.counted - l.expected, app.today(), t.id, l.reason, s.id
    from public.stocktake_lines l where l.stocktake_id = t.id and l.counted <> l.expected;
  end if;
  perform app.audit(case when p_approve then 'stock.stocktake_approved' else 'stock.stocktake_rejected' end,
                    'stocktakes', t.id, t.branch_id, null,
                    jsonb_build_object('note', p_note,
                      'lines', (select jsonb_agg(jsonb_build_object('product', p.name, 'expected', l.expected, 'counted', l.counted, 'reason', l.reason))
                                from public.stocktake_lines l join public.products p on p.id = l.product_id
                                where l.stocktake_id = t.id and l.counted <> l.expected)));
end $$;

create or replace function public.stock_overview(p_branch_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.staff; v_b uuid[];
begin
  v_b := app.stock_branches(p_branch_id, true);
  return jsonb_build_object(
    'branches', (select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) order by b.sort_order)
                 from public.branches b where b.id = any (v_b)),
    'products', (select coalesce(jsonb_agg(x order by x.sort_order, x.name), '[]'::jsonb) from (
        select p.id, p.name, p.price, p.status, p.sort_order,
          (select jsonb_object_agg(b, app.stock_on_hand(b, p.id)) from unnest(v_b) b) as on_hand,
          (select max(t.created_at) from public.stocktakes t join public.stocktake_lines l on l.stocktake_id = t.id
             where l.product_id = p.id and t.branch_id = any (v_b) and t.status = 'approved') as last_counted
        from public.products p
        where p.track_stock
          and (p.status = 'on_sale' or exists (select 1 from public.stock_movements m where m.product_id = p.id and m.branch_id = any (v_b)))
          and (p.all_branches or exists (select 1 from public.product_branches pb where pb.product_id = p.id and pb.branch_id = any (v_b))
               or exists (select 1 from public.stock_movements m where m.product_id = p.id and m.branch_id = any (v_b)))) x),
    'pending', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', t.id, 'branch', b.name, 'branch_id', t.branch_id, 'created_at', t.created_at, 'by', st.name, 'note', t.note,
          'lines', (select jsonb_agg(jsonb_build_object('product', p.name, 'expected', l.expected, 'counted', l.counted, 'reason', l.reason) order by p.name)
                    from public.stocktake_lines l join public.products p on p.id = l.product_id
                    where l.stocktake_id = t.id and l.counted <> l.expected)) order by t.created_at), '[]'::jsonb)
        from public.stocktakes t join public.branches b on b.id = t.branch_id join public.staff st on st.id = t.created_by
        where t.status = 'pending' and t.branch_id = any (v_b))
  );
end $$;

create or replace function public.stock_moves(p_from date, p_to date, p_branch_id uuid default null, p_product_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.staff; v_b uuid[];
begin
  v_b := app.stock_branches(p_branch_id, false);
  perform app.report_check_range(p_from, p_to);
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'at', m.created_at, 'date', m.business_date, 'branch', b.name, 'product', p.name,
      'kind', m.kind, 'quantity', m.quantity, 'note', m.note, 'staff', st.name,
      'order_no', (select o.order_no from public.order_items oi join public.orders o on o.id = oi.order_id where oi.id = m.order_item_id))
      order by m.created_at desc, m.id desc), '[]'::jsonb)
    from (select * from public.stock_movements
          where branch_id = any (v_b) and business_date between p_from and p_to
            and (p_product_id is null or product_id = p_product_id)
          order by created_at desc limit 2000) m
    join public.branches b on b.id = m.branch_id
    join public.products p on p.id = m.product_id
    left join public.staff st on st.id = m.staff_id);
end $$;

-- ---------------------------------------------------------------------
-- 6. 庫存頁新增商品：只在該分館販售、管理庫存
-- ---------------------------------------------------------------------
create or replace function public.create_stock_product(
  p_branch_id uuid, p_name text, p_price integer, p_category_id uuid
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.staff; v_id uuid;
begin
  s := app.stock_staff();
  if p_branch_id is null or not exists (select 1 from public.branches where id = p_branch_id) then
    raise exception '請選擇分館' using errcode = '22023';
  end if;
  if not app.can_manage_stock(p_branch_id) then
    raise exception '只有店長、庫存管理或總部可以新增商品' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception '請填寫商品名稱' using errcode = '22023'; end if;
  if p_price is null or p_price < 0 then raise exception '請填寫售價' using errcode = '22023'; end if;
  if not exists (select 1 from public.product_categories where id = p_category_id and is_active) then
    raise exception '請選擇分類' using errcode = '22023';
  end if;
  if exists (select 1 from public.products p
             where p.name = trim(p_name) and p.status = 'on_sale'
               and (p.all_branches or exists (select 1 from public.product_branches pb where pb.product_id = p.id and pb.branch_id = p_branch_id))) then
    raise exception '這間分館已經有「%」了', trim(p_name) using errcode = '22023';
  end if;
  insert into public.products (name, category_id, price, content_type, quantity, usage_rule, all_branches, track_stock, sort_order)
  values (trim(p_name), p_category_id, p_price, 'goods', 1, 'any', false, true,
          coalesce((select max(sort_order) from public.products where category_id = p_category_id), 0) + 10)
  returning id into v_id;
  insert into public.product_branches (product_id, branch_id) values (v_id, p_branch_id);
  perform app.audit('product.created', 'products', v_id, p_branch_id, null,
                    jsonb_build_object('name', trim(p_name), 'price', p_price, 'from', 'stock'));
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 1. 品項手動排序（總部）：依傳入順序重新編號 10、20、30…
-- ---------------------------------------------------------------------
create or replace function public.set_product_order(p_ids uuid[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.require_staff(array['hq']::public.staff_role[]);
  perform set_config('app.system_write', 'on', true);   -- 排序不需要每個品項各記一筆異動
  update public.products p set sort_order = x.n * 10
    from unnest(p_ids) with ordinality as x(id, n)
    where p.id = x.id and p.sort_order <> x.n * 10;
end $$;

-- ---------------------------------------------------------------------
-- 2、3. 轉讓費、升級全店通差價：在櫃檯結帳收，後台處理時選那筆訂單
-- ---------------------------------------------------------------------
alter table public.products add column if not exists fee_kind text
  check (fee_kind in ('transfer_fee', 'upgrade_fee'));
comment on column public.products.fee_kind is '費用品項：transfer_fee 方案轉讓費／upgrade_fee 單店升級全店通差價；結帳時要指定會員';

-- 原本的「方案轉讓費」改成一般費用品項（櫃檯結帳可以賣）
update public.products set fee_kind = 'transfer_fee', system_key = null where system_key = 'transfer_fee';
insert into public.products (name, category_id, price, content_type, quantity, usage_rule, all_branches, sort_order, status, fee_kind)
select '升級全店通（補差價）', (select id from public.product_categories order by (name = '套票・年月票') desc, sort_order limit 1),
       0, 'goods', 1, 'any', true, 9999, 'off_sale', 'upgrade_fee'
where not exists (select 1 from public.products where fee_kind = 'upgrade_fee');

-- 費用品項一定要指定會員（後台才找得到這筆訂單）
create or replace function app.fee_item_needs_member() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.products where id = new.product_id and fee_kind is not null)
     and (select member_id from public.orders where id = new.order_id) is null then
    raise exception '「%」需要指定會員', new.product_name using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists fee_item_needs_member on public.order_items;
create trigger fee_item_needs_member before insert on public.order_items
  for each row execute function app.fee_item_needs_member();

create table if not exists public.plan_fee_links (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null unique references public.orders(id),
  plan_id     uuid not null references public.member_plans(id),
  kind        text not null check (kind in ('transfer_fee', 'upgrade_fee')),
  staff_id    uuid references public.staff(id),
  created_at  timestamptz not null default now()
);
comment on table public.plan_fee_links is '轉讓費／升級差價訂單用在哪個方案（一筆訂單只能用一次）';
alter table public.plan_fee_links enable row level security;
grant select on public.plan_fee_links to authenticated;
create policy plan_fee_links_read on public.plan_fee_links for select to authenticated
  using (app.staff_role() in ('hq', 'manager'));
create trigger forbid_delete before delete on public.plan_fee_links for each row execute function app.forbid_delete();

-- 會員可以使用的費用訂單（已付款、還沒用過）；p_member_ids 通常是轉出與轉入兩位會員
create or replace function public.member_fee_orders(p_member_ids uuid[], p_kind text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform app.require_staff(array['hq', 'manager']::public.staff_role[]);
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'order_no', o.order_no, 'date', o.business_date, 'branch', b.name, 'total', o.total,
      'member', m.name,
      'items', (select string_agg(oi.product_name, '、' order by oi.created_at) from public.order_items oi where oi.order_id = o.id))
      order by o.created_at desc), '[]'::jsonb)
    from public.orders o
    join public.branches b on b.id = o.branch_id
    join public.members m on m.id = o.member_id
    where o.member_id = any (p_member_ids) and o.status = 'paid'
      and not exists (select 1 from public.plan_fee_links l where l.order_id = o.id)
      and exists (select 1 from public.order_items oi join public.products p on p.id = oi.product_id
                  where oi.order_id = o.id and p.fee_kind = p_kind));
end $$;

-- 檢查並登記費用訂單；沒有訂單時必須填免收原因
create or replace function app.use_fee_order(
  p_order uuid, p_kind text, p_members uuid[], p_plan uuid, p_waive text
) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare o public.orders;
begin
  if p_order is null then
    if length(trim(coalesce(p_waive, ''))) = 0 then
      raise exception '請選擇已在櫃檯收費的訂單，或填寫免收原因' using errcode = '22023';
    end if;
    return null;
  end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null or o.status <> 'paid' or not (o.member_id = any (p_members))
     or not exists (select 1 from public.order_items oi join public.products p on p.id = oi.product_id
                    where oi.order_id = o.id and p.fee_kind = p_kind) then
    raise exception '這筆訂單不能用（要是該會員已付款的%訂單）',
      case p_kind when 'transfer_fee' then '轉讓費' else '升級全店通' end using errcode = '22023';
  end if;
  if exists (select 1 from public.plan_fee_links where order_id = o.id) then
    raise exception '訂單 % 已經用過了', o.order_no using errcode = '22023';
  end if;
  insert into public.plan_fee_links (order_id, plan_id, kind, staff_id) values (o.id, p_plan, p_kind, app.staff_id());
  return o.order_no;
end $$;

-- 轉讓（總部、店長）：選擇櫃檯已收的轉讓費訂單，或填免收原因
drop function if exists public.transfer_plan(uuid, uuid, text, public.payment_method, uuid);
create or replace function public.transfer_plan(
  p_plan_id uuid, p_to_member_id uuid, p_reason text,
  p_fee_order_id uuid default null, p_waive_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare pl public.member_plans; v_to public.members; v_today date := app.today(); v_no text;
begin
  perform app.require_staff(array['hq', 'manager']::public.staff_role[]);
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
  v_no := app.use_fee_order(p_fee_order_id, 'transfer_fee', array[pl.member_id, p_to_member_id], pl.id, p_waive_reason);

  perform set_config('app.system_write', 'on', true);
  update public.member_plans
    set member_id = p_to_member_id,
        note = concat_ws('；', note, '由會員轉讓（' || v_today || '）')
    where id = pl.id;
  perform app.audit('member_plan.transferred', 'member_plans', pl.id, null, to_jsonb(pl),
                    jsonb_build_object('to_member_id', p_to_member_id, 'reason', p_reason,
                                       'order_no', v_no, 'waive_reason', nullif(trim(p_waive_reason), '')));
  return jsonb_build_object('order_no', v_no);
end $$;

-- 單店方案改成全店通用（總部、店長）：保留到期日與剩餘次數
create or replace function public.upgrade_plan_all_branches(
  p_plan_id uuid, p_fee_order_id uuid default null, p_waive_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare pl public.member_plans; v_no text;
begin
  perform app.require_staff(array['hq', 'manager']::public.staff_role[]);
  pl := app.require_plan_manager(p_plan_id);
  if pl.status not in ('active', 'frozen') then raise exception '只有使用中或暫停中的方案可以升級' using errcode = '22023'; end if;
  if pl.branch_ids is null then raise exception '「%」已經是全店通用', pl.name using errcode = '22023'; end if;
  v_no := app.use_fee_order(p_fee_order_id, 'upgrade_fee', array[pl.member_id], pl.id, p_waive_reason);
  perform set_config('app.system_write', 'on', true);
  update public.member_plans
    set branch_ids = null, note = concat_ws('；', note, '升級全店通用（' || app.today() || '）')
    where id = pl.id;
  perform app.audit('member_plan.upgraded', 'member_plans', pl.id, null, to_jsonb(pl),
                    jsonb_build_object('order_no', v_no, 'waive_reason', nullif(trim(p_waive_reason), '')));
  return jsonb_build_object('order_no', v_no);
end $$;

-- ---------------------------------------------------------------------
-- 4. 暫停指定期間
--   frozen_at＝開始暫停日、frozen_until＝結束暫停日（含當天，空白＝還不知道）
--   暫停天數＝結束 − 開始 + 1；知道結束日時就把到期日延長
--   status：今天在暫停期間＝frozen；開始日還沒到或已結束＝active（每天自動切換）
-- ---------------------------------------------------------------------
alter table public.member_plans add column if not exists frozen_until date;
comment on column public.member_plans.frozen_until is '結束暫停日（含當天）；空白＝暫停中、還沒決定何時恢復';

-- 依今天日期整理方案狀態（暫停開始／結束、到期、用完）；p_plan 空白＝全部
create or replace function app.settle_plans(p_plan uuid default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_today date := app.today();
begin
  perform set_config('app.system_write', 'on', true);
  -- 暫停期間結束 → 恢復使用
  update public.member_plans set status = 'active', frozen_at = null, frozen_until = null
    where (p_plan is null or id = p_plan) and status = 'frozen' and frozen_until < v_today;
  -- 預定的暫停期間已經過了（還沒切換就結束了）→ 清掉
  update public.member_plans set frozen_at = null, frozen_until = null
    where (p_plan is null or id = p_plan) and status = 'active' and frozen_until < v_today;
  -- 暫停開始日到了 → 暫停
  update public.member_plans set status = 'frozen'
    where (p_plan is null or id = p_plan) and status = 'active' and frozen_at <= v_today
      and (frozen_until is null or frozen_until >= v_today);
  update public.member_plans set status = 'expired'
    where (p_plan is null or id = p_plan) and status = 'active' and end_date < v_today;
  update public.member_plans set status = 'used_up'
    where (p_plan is null or id = p_plan) and status = 'active' and content_type <> 'days' and remaining_count <= 0;
end $$;

-- 入場判斷：除了狀態，也直接看暫停期間（就算每天的自動切換還沒跑也擋得住）
create or replace function app.plan_block_reason(p public.member_plans, p_branch uuid)
returns public.checkin_result
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_today date := app.today(); v_time time := app.now_tpe()::time;
begin
  if p.status = 'cancelled' then return 'no_valid_plan'; end if;
  if p.status = 'frozen' and (p.frozen_until is null or p.frozen_until >= v_today) then return 'no_valid_plan'; end if;
  if p.frozen_at is not null and p.frozen_at <= v_today and (p.frozen_until is null or p.frozen_until >= v_today) then
    return 'no_valid_plan';
  end if;
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

-- 暫停：p_start 開始暫停日（空白＝今天，可以是過去或未來）、p_end 結束暫停日（含當天，可空白）
drop function if exists public.freeze_plan(uuid, text);
create or replace function public.freeze_plan(
  p_plan_id uuid, p_reason text, p_start date default null, p_end date default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare pl public.member_plans; v_start date := coalesce(p_start, app.today()); v_days int;
begin
  pl := app.require_plan_manager(p_plan_id);
  if pl.status <> 'active' or pl.frozen_at is not null then
    raise exception '只有使用中、沒有預定暫停的方案可以暫停' using errcode = '22023';
  end if;
  if p_end is not null and p_end < v_start then raise exception '結束暫停日不能早於開始暫停日' using errcode = '22023'; end if;
  if pl.start_date is not null and v_start < pl.start_date then
    raise exception '開始暫停日不能早於方案開始日（%）', pl.start_date using errcode = '22023';
  end if;
  if pl.end_date is not null and v_start > pl.end_date then
    raise exception '開始暫停日不能晚於方案到期日（%）', pl.end_date using errcode = '22023';
  end if;
  v_days := case when p_end is not null then p_end - v_start + 1 end;
  perform set_config('app.system_write', 'on', true);
  update public.member_plans
    set frozen_at = v_start, frozen_until = p_end,
        end_date = case when end_date is not null then end_date + coalesce(v_days, 0) end
    where id = pl.id;
  perform app.settle_plans(pl.id);
  perform app.audit('member_plan.frozen', 'member_plans', pl.id, null, to_jsonb(pl),
                    jsonb_build_object('reason', p_reason, 'start', v_start, 'end', p_end, 'days', v_days));
  return (select jsonb_build_object('status', status, 'end_date', end_date, 'days', v_days) from public.member_plans where id = pl.id);
end $$;

-- 恢復／修改暫停：p_end 結束暫停日（含當天；空白＝昨天，也就是今天恢復）
--   結束日早於開始日＝取消這次暫停；到期日依新的暫停天數重新計算
drop function if exists public.unfreeze_plan(uuid);
create or replace function public.unfreeze_plan(p_plan_id uuid, p_end date default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare pl public.member_plans; v_end date := coalesce(p_end, app.today() - 1); v_old int; v_new int;
begin
  pl := app.require_plan_manager(p_plan_id);
  if pl.frozen_at is null or pl.status not in ('active', 'frozen') then
    raise exception '這個方案沒有在暫停中' using errcode = '22023';
  end if;
  v_old := case when pl.frozen_until is not null then pl.frozen_until - pl.frozen_at + 1 else 0 end;
  v_new := greatest(v_end - pl.frozen_at + 1, 0);
  perform set_config('app.system_write', 'on', true);
  update public.member_plans
    set frozen_at = case when v_end < frozen_at then null else frozen_at end,       -- 取消這次暫停
        frozen_until = case when v_end < frozen_at then null else v_end end,
        status = case when v_end < frozen_at then 'active'::public.plan_status else status end,
        end_date = case when end_date is not null then end_date + v_new - v_old end
    where id = pl.id;
  perform app.settle_plans(pl.id);
  perform app.audit('member_plan.unfrozen', 'member_plans', pl.id, null, to_jsonb(pl),
                    jsonb_build_object('start', pl.frozen_at, 'end', v_end, 'days', v_new, 'extended_days', v_new - v_old));
  return (select jsonb_build_object('status', status, 'end_date', end_date, 'days', v_new) from public.member_plans where id = pl.id);
end $$;

-- 每天 00:01（台灣時間）自動整理方案狀態；Supabase 有 pg_cron。沒有的環境（本機測試）略過
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('origin-settle-plans', '1 16 * * *', 'select app.settle_plans()');
exception when others then
  raise notice '沒有安裝 pg_cron（%），略過每日自動整理', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- 權限
-- ---------------------------------------------------------------------
revoke all on function app.stock_staff(), app.can_manage_stock(uuid), app.stock_branches(uuid, boolean),
  app.use_fee_order(uuid, text, uuid[], uuid, text), app.settle_plans(uuid), app.fee_item_needs_member()
  from public, anon, authenticated;
revoke all on function public.create_stock_product(uuid, text, integer, uuid), public.set_product_order(uuid[]),
  public.member_fee_orders(uuid[], text), public.transfer_plan(uuid, uuid, text, uuid, text),
  public.upgrade_plan_all_branches(uuid, uuid, text), public.freeze_plan(uuid, text, date, date),
  public.unfreeze_plan(uuid, date) from public, anon;
grant execute on function public.create_stock_product(uuid, text, integer, uuid), public.set_product_order(uuid[]),
  public.member_fee_orders(uuid[], text), public.transfer_plan(uuid, uuid, text, uuid, text),
  public.upgrade_plan_all_branches(uuid, uuid, text), public.freeze_plan(uuid, text, date, date),
  public.unfreeze_plan(uuid, date) to authenticated;
