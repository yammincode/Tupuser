-- =====================================================================
-- 原岩攀岩館 會員與櫃檯系統
-- 第 17 部分：庫存（老闆 2026-10-01 決定）
--   「商品／租借」類的品項可以勾選「管理庫存」
--   每間分館各算各的；進貨、賣出（結帳自動扣）、作廢退費（自動加回）、調撥、報廢、盤點調整都記一筆異動
--   櫃檯可以登記進貨、送出盤點；盤點有差異要店長以上確認才會調整庫存
--   調撥與報廢限店長以上
--   紀錄只能新增，不能修改或刪除
-- =====================================================================

alter table public.products add column track_stock boolean not null default false;
comment on column public.products.track_stock is '管理庫存（商品／租借類）：結帳時自動扣庫存';

create table public.stock_movements (
  id             bigint generated always as identity primary key,
  branch_id      uuid not null references public.branches(id),
  product_id     uuid not null references public.products(id),
  kind           text not null check (kind in ('purchase', 'sale', 'return', 'adjust', 'transfer_out', 'transfer_in', 'scrap')),
  quantity       integer not null check (quantity <> 0),
  business_date  date not null,
  order_item_id  uuid references public.order_items(id),
  stocktake_id   uuid,
  note           text,
  staff_id       uuid references public.staff(id),
  created_at     timestamptz not null default now()
);
comment on table public.stock_movements is '庫存異動：進貨(+)、銷售(-)、作廢退費退回(+)、盤點調整(±)、調出(-)、調入(+)、報廢(-)';
create index on public.stock_movements (branch_id, product_id);
create index on public.stock_movements (created_at desc);

create table public.stocktakes (
  id           uuid primary key default gen_random_uuid(),
  branch_id    uuid not null references public.branches(id),
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  note         text,
  created_by   uuid not null references public.staff(id),
  created_at   timestamptz not null default now(),
  decided_by   uuid references public.staff(id),
  decided_at   timestamptz,
  decide_note  text
);
comment on table public.stocktakes is '盤點：有差異時待店長確認（approved 才會調整庫存）';

create table public.stocktake_lines (
  stocktake_id  uuid not null references public.stocktakes(id),
  product_id    uuid not null references public.products(id),
  expected      integer not null,
  counted       integer not null check (counted >= 0),
  reason        text,
  primary key (stocktake_id, product_id)
);
comment on table public.stocktake_lines is '盤點明細：expected＝盤點當下系統數量，counted＝實際數到的數量';

alter table public.stock_movements
  add constraint stock_movements_stocktake_fk foreign key (stocktake_id) references public.stocktakes(id);

-- 不能刪除；異動與明細也不能修改（盤點本身只能由函式改狀態）
create trigger forbid_delete before delete on public.stock_movements for each row execute function app.forbid_delete();
create trigger forbid_delete before delete on public.stocktakes for each row execute function app.forbid_delete();
create trigger forbid_delete before delete on public.stocktake_lines for each row execute function app.forbid_delete();
create or replace function app.forbid_update_stock() returns trigger
language plpgsql as $$
begin
  raise exception '庫存紀錄不能修改' using errcode = '42501';
end $$;
create trigger forbid_update before update on public.stock_movements for each row execute function app.forbid_update_stock();
create trigger forbid_update before update on public.stocktake_lines for each row execute function app.forbid_update_stock();

-- 讀取：自己分館的員工（總部看全部）；寫入只能透過下面的函式
alter table public.stock_movements enable row level security;
alter table public.stocktakes enable row level security;
alter table public.stocktake_lines enable row level security;
revoke all on public.stock_movements, public.stocktakes, public.stocktake_lines from public, anon, authenticated;
grant select on public.stock_movements, public.stocktakes, public.stocktake_lines to authenticated;
create policy stock_movements_read on public.stock_movements for select to authenticated using (app.is_branch_staff(branch_id));
create policy stocktakes_read on public.stocktakes for select to authenticated using (app.is_branch_staff(branch_id));
create policy stocktake_lines_read on public.stocktake_lines for select to authenticated
  using (exists (select 1 from public.stocktakes t where t.id = stocktake_id and app.is_branch_staff(t.branch_id)));

-- 目前庫存
create or replace function app.stock_on_hand(p_branch uuid, p_product uuid) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(quantity), 0)::int from public.stock_movements where branch_id = p_branch and product_id = p_product
$$;

-- 確認是這間分館的員工（櫃檯以上）；回傳員工
create or replace function app.require_branch_staff(p_branch uuid) returns public.staff
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.staff;
begin
  s := app.require_staff(array['hq', 'manager', 'cashier']::public.staff_role[]);
  if p_branch is null or not exists (select 1 from public.branches where id = p_branch) then
    raise exception '請選擇分館' using errcode = '22023';
  end if;
  if s.role <> 'hq' and s.branch_id <> p_branch then
    raise exception '只能操作自己分館的庫存' using errcode = '42501';
  end if;
  return s;
end $$;

-- 檢查品項是否有管理庫存
create or replace function app.require_stock_product(p_product uuid) returns public.products
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare pr public.products;
begin
  select * into pr from public.products where id = p_product;
  if pr.id is null then raise exception '找不到品項' using errcode = 'P0002'; end if;
  if not pr.track_stock then raise exception '「%」沒有設定管理庫存', pr.name using errcode = '22023'; end if;
  return pr;
end $$;

-- ---------------------------------------------------------------------
-- 結帳自動扣庫存；作廢或退費自動加回
-- ---------------------------------------------------------------------
create or replace function app.stock_on_sale() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare o public.orders;
begin
  if exists (select 1 from public.products where id = new.product_id and track_stock) then
    select * into o from public.orders where id = new.order_id;
    insert into public.stock_movements (branch_id, product_id, kind, quantity, business_date, order_item_id, staff_id)
    values (o.branch_id, new.product_id, 'sale', -new.quantity, o.business_date, new.id, o.cashier_staff_id);
  end if;
  return new;
end $$;
create trigger stock_on_sale after insert on public.order_items
  for each row execute function app.stock_on_sale();

create or replace function app.stock_on_void() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.status = 'paid' and new.status in ('voided', 'refunded') then
    insert into public.stock_movements (branch_id, product_id, kind, quantity, business_date, order_item_id, note, staff_id)
    select m.branch_id, m.product_id, 'return', -m.quantity, app.today(), m.order_item_id,
           case when new.status = 'voided' then '訂單作廢退回' else '訂單退費退回' end, app.staff_id()
    from public.stock_movements m
    join public.order_items oi on oi.id = m.order_item_id
    where oi.order_id = new.id and m.kind = 'sale';
  end if;
  return new;
end $$;
create trigger stock_on_void after update of status on public.orders
  for each row execute function app.stock_on_void();

-- ---------------------------------------------------------------------
-- 進貨（櫃檯以上）：p_items = [{product_id, quantity}]
-- ---------------------------------------------------------------------
create or replace function public.stock_receive(p_branch_id uuid, p_items jsonb, p_note text default null)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.staff; it jsonb; pr public.products; q integer; n integer := 0;
begin
  s := app.require_branch_staff(p_branch_id);
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    pr := app.require_stock_product((it ->> 'product_id')::uuid);
    q := coalesce((it ->> 'quantity')::int, 0);
    if q < 1 or q > 100000 then raise exception '「%」的進貨數量不正確', pr.name using errcode = '22023'; end if;
    insert into public.stock_movements (branch_id, product_id, kind, quantity, business_date, note, staff_id)
    values (p_branch_id, pr.id, 'purchase', q, app.today(), nullif(trim(p_note), ''), s.id);
    n := n + 1;
  end loop;
  if n = 0 then raise exception '請輸入進貨的商品與數量' using errcode = '22023'; end if;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 調撥（店長以上，從自己分館調出）：p_items = [{product_id, quantity}]
-- ---------------------------------------------------------------------
create or replace function public.stock_transfer(p_from uuid, p_to uuid, p_items jsonb, p_note text default null)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.staff; it jsonb; pr public.products; q integer; n integer := 0;
begin
  s := app.require_staff(array['hq', 'manager']::public.staff_role[]);
  if not app.can_manage_branch(p_from) then raise exception '只能從自己的分館調出' using errcode = '42501'; end if;
  if p_to is null or p_to = p_from or not exists (select 1 from public.branches where id = p_to) then
    raise exception '請選擇要調入的分館' using errcode = '22023';
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

-- ---------------------------------------------------------------------
-- 報廢（店長以上）：p_items = [{product_id, quantity}]，原因必填
-- ---------------------------------------------------------------------
create or replace function public.stock_scrap(p_branch_id uuid, p_items jsonb, p_reason text)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.staff; it jsonb; pr public.products; q integer; n integer := 0;
begin
  s := app.require_staff(array['hq', 'manager']::public.staff_role[]);
  if not app.can_manage_branch(p_branch_id) then raise exception '只能處理自己分館的庫存' using errcode = '42501'; end if;
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

-- ---------------------------------------------------------------------
-- 盤點（櫃檯以上送出）：p_lines = [{product_id, counted, reason}]
--   系統記下盤點當下的數量；全部沒差異就直接完成，有差異等店長確認
-- ---------------------------------------------------------------------
create or replace function public.stocktake_submit(p_branch_id uuid, p_lines jsonb, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.staff; ln jsonb; pr public.products; v_id uuid; c integer; e integer; v_diff integer := 0; n integer := 0;
begin
  s := app.require_branch_staff(p_branch_id);
  if exists (select 1 from public.stocktakes where branch_id = p_branch_id and status = 'pending') then
    raise exception '這間分館還有一筆盤點等待店長確認，請先處理' using errcode = '22023';
  end if;
  insert into public.stocktakes (branch_id, note, created_by) values (p_branch_id, nullif(trim(p_note), ''), s.id)
  returning id into v_id;
  for ln in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    pr := app.require_stock_product((ln ->> 'product_id')::uuid);
    c := (ln ->> 'counted')::int;
    if c is null or c < 0 then raise exception '「%」的實際數量不正確', pr.name using errcode = '22023'; end if;
    e := app.stock_on_hand(p_branch_id, pr.id);
    if c <> e and length(trim(coalesce(ln ->> 'reason', ''))) = 0 then
      raise exception '「%」有差異（系統 %，實際 %），請填寫原因', pr.name, e, c using errcode = '22023';
    end if;
    insert into public.stocktake_lines (stocktake_id, product_id, expected, counted, reason)
    values (v_id, pr.id, e, c, nullif(trim(ln ->> 'reason'), ''));
    if c <> e then v_diff := v_diff + 1; end if;
    n := n + 1;
  end loop;
  if n = 0 then raise exception '請輸入盤點數量' using errcode = '22023'; end if;
  if v_diff = 0 then
    update public.stocktakes set status = 'approved', decided_by = s.id, decided_at = now(), decide_note = '沒有差異，自動完成'
      where id = v_id;
  end if;
  return jsonb_build_object('id', v_id, 'differences', v_diff, 'status', case when v_diff = 0 then 'approved' else 'pending' end);
end $$;

-- 店長以上確認盤點：依「盤點當下」的差異調整庫存（盤點後的銷售不受影響）
create or replace function public.stocktake_decide(p_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.staff; t public.stocktakes;
begin
  s := app.require_staff(array['hq', 'manager']::public.staff_role[]);
  select * into t from public.stocktakes where id = p_id for update;
  if t.id is null then raise exception '找不到盤點' using errcode = 'P0002'; end if;
  if not app.can_manage_branch(t.branch_id) then raise exception '只能確認自己分館的盤點' using errcode = '42501'; end if;
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

-- ---------------------------------------------------------------------
-- 查詢
-- ---------------------------------------------------------------------
-- 庫存總覽：p_branch_id 空白＝可看到的全部分館（總部）
create or replace function public.stock_overview(p_branch_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.staff; v_b uuid[];
begin
  s := app.require_staff(array['hq', 'manager', 'cashier']::public.staff_role[]);
  if s.role <> 'hq' then v_b := array[s.branch_id];
  elsif p_branch_id is not null then v_b := array[p_branch_id];
  else select array_agg(id order by sort_order) into v_b from public.branches where is_active;
  end if;
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

-- 異動明細
create or replace function public.stock_moves(p_from date, p_to date, p_branch_id uuid default null, p_product_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.staff; v_b uuid[];
begin
  s := app.require_staff(array['hq', 'manager', 'cashier']::public.staff_role[]);
  perform app.report_check_range(p_from, p_to);
  if s.role <> 'hq' then v_b := array[s.branch_id];
  elsif p_branch_id is not null then v_b := array[p_branch_id];
  else select array_agg(id) into v_b from public.branches;
  end if;
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

-- 異動紀錄查詢：多一個「庫存」種類
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
            when 'stock' then l.action like 'stock.%'
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

revoke all on function app.stock_on_hand(uuid, uuid), app.require_branch_staff(uuid), app.require_stock_product(uuid)
  from public, anon, authenticated;
revoke all on function public.stock_receive(uuid, jsonb, text), public.stock_transfer(uuid, uuid, jsonb, text),
  public.stock_scrap(uuid, jsonb, text), public.stocktake_submit(uuid, jsonb, text), public.stocktake_decide(uuid, boolean, text),
  public.stock_overview(uuid), public.stock_moves(date, date, uuid, uuid) from public, anon;
grant execute on function public.stock_receive(uuid, jsonb, text), public.stock_transfer(uuid, uuid, jsonb, text),
  public.stock_scrap(uuid, jsonb, text), public.stocktake_submit(uuid, jsonb, text), public.stocktake_decide(uuid, boolean, text),
  public.stock_overview(uuid), public.stock_moves(date, date, uuid, uuid) to authenticated;
