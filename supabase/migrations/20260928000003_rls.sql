-- =====================================================================
-- 原岩攀岩館 會員與櫃檯系統
-- 第 3 部分：權限（Row Level Security）
--
-- 原則：
--   總部 hq       ：所有分館
--   店長 manager  ：只管自己分館
--   櫃檯 cashier  ：讀品項、查詢／新增會員、結帳、入場、關帳；不能改品項和價格
--   會員          ：只看得到自己的資料（櫃檯備註看不到）
--   入場機        ：只能呼叫 kiosk_checkin
-- 結帳、入場、作廢、退款、關帳一律透過函式執行，不開放直接寫入資料表。
-- 任何資料表都不開放刪除（品項適用分館除外）。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 先收回所有預設權限，再逐一開放
-- ---------------------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all tables    in schema app    from public, anon, authenticated;
revoke all on all functions in schema app    from public, anon, authenticated;

grant usage on schema app to authenticated;
grant execute on function
  app.staff_id(), app.staff_role(), app.staff_branch_id(), app.is_staff(), app.is_hq(),
  app.is_branch_staff(uuid), app.can_manage_branch(uuid), app.member_id(), app.device(), app.today()
  to authenticated;

-- 開放給登入者呼叫的功能（函式內部會再檢查身分）
grant execute on function
  public.get_my_qr_secret(),
  public.kiosk_checkin(text),
  public.counter_checkin(uuid, uuid, uuid),
  public.cancel_checkin(uuid),
  public.checkout(jsonb),
  public.void_order(uuid, text),
  public.refund_order(uuid, public.payment_method, integer, text, text),
  public.closing_preview(uuid, date),
  public.close_day(integer, integer, text, uuid, date),
  public.reopen_day(date, text, uuid),
  public.get_my_profile(),
  public.register_me(text, date, uuid, text, text, text, text, text, boolean),
  public.update_my_profile(jsonb)
  to authenticated;

-- 所有資料表啟用 RLS
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 分館
-- ---------------------------------------------------------------------
grant select, insert, update on public.branches to authenticated;
create policy branches_read on public.branches for select to authenticated using (true);
create policy branches_hq_insert on public.branches for insert to authenticated with check (app.is_hq());
create policy branches_hq_update on public.branches for update to authenticated using (app.is_hq());

-- ---------------------------------------------------------------------
-- 員工：總部管全部；店長可管理自己分館的櫃檯；員工可看同分館同事（選業務代表用）
-- ---------------------------------------------------------------------
grant select, insert, update on public.staff to authenticated;
create policy staff_read on public.staff for select to authenticated
  using (app.is_hq() or auth_user_id = auth.uid()
         or (app.is_staff() and branch_id = app.staff_branch_id()));
create policy staff_insert on public.staff for insert to authenticated
  with check (app.is_hq()
              or (app.staff_role() = 'manager' and role = 'cashier' and branch_id = app.staff_branch_id()));
create policy staff_update on public.staff for update to authenticated
  using (app.is_hq()
         or (app.staff_role() = 'manager' and role = 'cashier' and branch_id = app.staff_branch_id()))
  with check (app.is_hq()
         or (app.staff_role() = 'manager' and role = 'cashier' and branch_id = app.staff_branch_id()));

-- ---------------------------------------------------------------------
-- 裝置
-- ---------------------------------------------------------------------
grant select, insert, update on public.devices to authenticated;
create policy devices_read on public.devices for select to authenticated
  using (app.is_branch_staff(branch_id));
create policy devices_hq_insert on public.devices for insert to authenticated with check (app.is_hq());
create policy devices_manage_update on public.devices for update to authenticated
  using (app.can_manage_branch(branch_id)) with check (app.can_manage_branch(branch_id));

-- ---------------------------------------------------------------------
-- 國定假日
-- ---------------------------------------------------------------------
grant select, insert, update, delete on public.holidays to authenticated;
create policy holidays_read on public.holidays for select to authenticated using (true);
create policy holidays_hq_insert on public.holidays for insert to authenticated with check (app.is_hq());
create policy holidays_hq_update on public.holidays for update to authenticated using (app.is_hq());
create policy holidays_hq_delete on public.holidays for delete to authenticated using (app.is_hq());

-- ---------------------------------------------------------------------
-- 會員：全連鎖共用。員工都可查詢與新增；店長以上可修改；手機只有總部能改（觸發器把關）
-- 會員本人透過 get_my_profile / update_my_profile 存取（看不到櫃檯備註）
-- ---------------------------------------------------------------------
grant select, insert on public.members to authenticated;
grant usage on sequence public.member_no_seq to authenticated;
grant update (name, birthday, avatar_path, emergency_name, emergency_phone, emergency_relation,
              carrier_code, email, home_branch_id, status, staff_note, legacy_17fit_id,
              marketing_opt_in, phone)
  on public.members to authenticated;
create policy members_staff_read on public.members for select to authenticated using (app.is_staff());
create policy members_staff_insert on public.members for insert to authenticated with check (app.is_staff());
create policy members_manager_update on public.members for update to authenticated
  using (app.staff_role() in ('hq', 'manager')) with check (app.staff_role() in ('hq', 'manager'));

-- ---------------------------------------------------------------------
-- 同意書
-- ---------------------------------------------------------------------
grant select, insert, update on public.waiver_versions to authenticated;
create policy waiver_versions_read on public.waiver_versions for select to authenticated using (true);
create policy waiver_versions_hq_insert on public.waiver_versions for insert to authenticated with check (app.is_hq());
create policy waiver_versions_hq_update on public.waiver_versions for update to authenticated using (app.is_hq());

grant select, insert on public.waiver_signatures to authenticated;
create policy waiver_signatures_read on public.waiver_signatures for select to authenticated
  using (app.is_staff() or member_id = app.member_id());
create policy waiver_signatures_staff_insert on public.waiver_signatures for insert to authenticated
  with check (app.is_staff() and method in ('counter', 'paper'));
create policy waiver_signatures_member_insert on public.waiver_signatures for insert to authenticated
  with check (member_id = app.member_id() and method = 'app');

-- ---------------------------------------------------------------------
-- 品項：只有總部能新增與修改（含價格、上下架）
-- ---------------------------------------------------------------------
grant select, insert, update on public.product_categories to authenticated;
create policy categories_read on public.product_categories for select to authenticated using (true);
create policy categories_hq_insert on public.product_categories for insert to authenticated with check (app.is_hq());
create policy categories_hq_update on public.product_categories for update to authenticated using (app.is_hq());

grant select, insert, update on public.products to authenticated;
create policy products_read on public.products for select to authenticated
  using (app.is_staff() or status = 'on_sale');
create policy products_hq_insert on public.products for insert to authenticated with check (app.is_hq());
create policy products_hq_update on public.products for update to authenticated using (app.is_hq());

grant select, insert, delete on public.product_branches to authenticated;
create policy product_branches_read on public.product_branches for select to authenticated using (true);
create policy product_branches_hq_insert on public.product_branches for insert to authenticated with check (app.is_hq());
create policy product_branches_hq_delete on public.product_branches for delete to authenticated using (app.is_hq());

-- ---------------------------------------------------------------------
-- 會員方案：結帳時自動產生。店長以上可手動調整（暫停、補償、改到期日），會留異動紀錄
-- ---------------------------------------------------------------------
grant select, insert on public.member_plans to authenticated;
grant update (status, remaining_count, start_date, end_date, note) on public.member_plans to authenticated;
create policy member_plans_read on public.member_plans for select to authenticated
  using (app.is_staff() or member_id = app.member_id());
create policy member_plans_manager_insert on public.member_plans for insert to authenticated
  with check (app.staff_role() in ('hq', 'manager') and order_item_id is null);
create policy member_plans_manager_update on public.member_plans for update to authenticated
  using (app.staff_role() in ('hq', 'manager')) with check (app.staff_role() in ('hq', 'manager'));

-- ---------------------------------------------------------------------
-- 訂單、明細、付款、退款：只能透過 checkout / void_order / refund_order 寫入
-- 店長以上可修改訂單的備註、業務代表、發票欄位（關帳後也可以，會留紀錄）
-- ---------------------------------------------------------------------
grant select on public.orders, public.order_items, public.payments, public.refunds to authenticated;
grant update (note, sales_staff_id, discount_reason, invoice_type, invoice_carrier, invoice_tax_id, invoice_no)
  on public.orders to authenticated;

create policy orders_read on public.orders for select to authenticated
  using (app.is_branch_staff(branch_id) or member_id = app.member_id());
create policy orders_manager_update on public.orders for update to authenticated
  using (app.can_manage_branch(branch_id)) with check (app.can_manage_branch(branch_id));

create policy order_items_read on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id
                 and (app.is_branch_staff(o.branch_id) or o.member_id = app.member_id())));
create policy payments_read on public.payments for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id
                 and (app.is_branch_staff(o.branch_id) or o.member_id = app.member_id())));
create policy refunds_read on public.refunds for select to authenticated
  using (app.is_branch_staff(branch_id)
         or exists (select 1 from public.orders o where o.id = order_id and o.member_id = app.member_id()));

-- ---------------------------------------------------------------------
-- 入場紀錄：員工可查全連鎖（查會員歷史用）；會員看自己；寫入只能透過入場函式
-- ---------------------------------------------------------------------
grant select on public.checkins to authenticated;
create policy checkins_read on public.checkins for select to authenticated
  using (app.is_staff() or member_id = app.member_id());

-- ---------------------------------------------------------------------
-- 關帳：透過 close_day / reopen_day
-- ---------------------------------------------------------------------
grant select on public.daily_closings to authenticated;
create policy closings_read on public.daily_closings for select to authenticated
  using (app.is_branch_staff(branch_id));

-- ---------------------------------------------------------------------
-- 異動紀錄：總部看全部，店長看自己分館
-- ---------------------------------------------------------------------
grant select on public.audit_logs to authenticated;
create policy audit_read on public.audit_logs for select to authenticated
  using (app.is_hq() or (app.staff_role() = 'manager' and branch_id = app.staff_branch_id()));

-- Supabase 的登入系統（supabase_auth_admin）建立帳號時會觸發 app.link_auth_user，保險起見給它使用 app 的權限
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema app to supabase_auth_admin;
  end if;
end $$;
