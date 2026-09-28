-- =====================================================================
-- 原岩攀岩館 會員與櫃檯系統
-- 第 2 部分：輔助函式、自動規則（觸發器）、業務功能（結帳／入場／退款／關帳）
-- =====================================================================

-- =====================================================================
-- A. 身分判斷
-- =====================================================================

create or replace function app.staff_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from public.staff where auth_user_id = auth.uid() and status = 'active'
$$;

create or replace function app.staff_role() returns public.staff_role
language sql stable security definer set search_path = public, pg_temp as $$
  select role from public.staff where auth_user_id = auth.uid() and status = 'active'
$$;

create or replace function app.staff_branch_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select branch_id from public.staff where auth_user_id = auth.uid() and status = 'active'
$$;

create or replace function app.is_staff() returns boolean
language sql stable as $$ select app.staff_id() is not null $$;

create or replace function app.is_hq() returns boolean
language sql stable as $$ select coalesce(app.staff_role() = 'hq', false) $$;

-- 是否為該分館的員工（總部視為所有分館的員工）
create or replace function app.is_branch_staff(p_branch uuid) returns boolean
language sql stable as $$
  select app.is_hq() or (app.staff_id() is not null and app.staff_branch_id() = p_branch)
$$;

-- 是否能管理該分館（總部，或該分館店長）
create or replace function app.can_manage_branch(p_branch uuid) returns boolean
language sql stable as $$
  select app.is_hq() or (app.staff_role() = 'manager' and app.staff_branch_id() = p_branch)
$$;

create or replace function app.member_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from public.members where auth_user_id = auth.uid()
$$;

create or replace function app.device() returns public.devices
language sql stable security definer set search_path = public, pg_temp as $$
  select * from public.devices where auth_user_id = auth.uid() and status = 'active'
$$;

-- 取得目前員工；不是指定角色就擋下
create or replace function app.require_staff(p_roles public.staff_role[]) returns public.staff
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.staff;
begin
  select * into s from public.staff where auth_user_id = auth.uid() and status = 'active';
  if s.id is null then
    raise exception '請先以員工帳號登入' using errcode = '42501';
  end if;
  if not (s.role = any (p_roles)) then
    raise exception '您的權限不足以執行此操作' using errcode = '42501';
  end if;
  return s;
end $$;

-- 該分館該日是否已關帳（重新開帳者不算）
create or replace function app.day_closed(p_branch uuid, p_date date) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.daily_closings
    where branch_id = p_branch and business_date = p_date and reopened_at is null
  )
$$;

-- 是否為假日（週六、週日或國定假日）
create or replace function app.is_holiday(p_date date) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select extract(isodow from p_date) in (6, 7)
      or exists (select 1 from public.holidays where date = p_date)
$$;

-- 寫入異動紀錄
create or replace function app.audit(
  p_action text, p_table text, p_record uuid, p_branch uuid, p_before jsonb, p_after jsonb
) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.audit_logs (staff_id, branch_id, action, table_name, record_id, before, after)
  values (app.staff_id(), p_branch, p_action, p_table, p_record, p_before, p_after)
$$;

-- =====================================================================
-- B. 帳號連結：員工／裝置用 Email，會員用手機號碼
-- =====================================================================

-- 有人在 Supabase 登入系統建立或變更帳號時，自動連到對應的員工／裝置／會員
create or replace function app.link_auth_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.email is not null then
    update public.staff set auth_user_id = new.id
      where lower(email) = lower(new.email) and auth_user_id is null;
    update public.devices set auth_user_id = new.id
      where lower(email) = lower(new.email) and auth_user_id is null;
  end if;
  if new.phone is not null and new.phone <> '' then
    update public.members set auth_user_id = new.id
      where phone = '+' || ltrim(new.phone, '+') and auth_user_id is null;
  end if;
  return new;
end $$;

create trigger link_auth_user
  after insert or update of email, phone on auth.users
  for each row execute function app.link_auth_user();

-- 先建帳號、後建員工／裝置資料時，也能自動連上
create or replace function app.link_by_email() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.email := lower(trim(new.email));
  if new.auth_user_id is null then
    select id into new.auth_user_id from auth.users where lower(email) = new.email limit 1;
  end if;
  return new;
end $$;

create trigger link_by_email before insert or update of email on public.staff
  for each row execute function app.link_by_email();
create trigger link_by_email before insert or update of email on public.devices
  for each row execute function app.link_by_email();

-- =====================================================================
-- C. 會員資料規則
-- =====================================================================

create or replace function app.members_before_write() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.phone := app.normalize_phone(new.phone);
  new.carrier_code := nullif(upper(trim(new.carrier_code)), '');
  new.email := nullif(lower(trim(new.email)), '');

  if tg_op = 'INSERT' then
    new.created_by_staff_id := coalesce(new.created_by_staff_id, app.staff_id());
    if new.marketing_opt_in then new.marketing_opt_in_at := now(); end if;
    if new.auth_user_id is null then
      select id into new.auth_user_id from auth.users
        where '+' || ltrim(phone, '+') = new.phone limit 1;
    end if;
    return new;
  end if;

  -- 以下為修改
  if new.member_no is distinct from old.member_no
     or new.created_by_staff_id is distinct from old.created_by_staff_id then
    raise exception '會員編號與建立者不可修改' using errcode = '42501';
  end if;

  if new.phone is distinct from old.phone then
    -- 只有總部可以改手機號碼（auth.uid() 為空代表是系統管理端，例如 Supabase 後台）
    if auth.uid() is not null and not app.is_hq() then
      raise exception '只有總部可以修改會員手機號碼' using errcode = '42501';
    end if;
    -- 手機就是登入帳號：換號後舊帳號失效、QR 密鑰重發
    new.auth_user_id := null;
    select id into new.auth_user_id from auth.users
      where '+' || ltrim(phone, '+') = new.phone limit 1;
    update app.member_qr_keys
      set secret = extensions.gen_random_bytes(20), last_used_step = 0, rotated_at = now()
      where member_id = new.id;
    perform app.audit('member.phone_changed', 'members', new.id, new.home_branch_id,
                      jsonb_build_object('phone', old.phone), jsonb_build_object('phone', new.phone));
  end if;

  if new.marketing_opt_in is distinct from old.marketing_opt_in then
    new.marketing_opt_in_at := now();
  end if;

  if new.status is distinct from old.status then
    perform app.audit('member.status_changed', 'members', new.id, new.home_branch_id,
                      jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));
  end if;
  return new;
end $$;

create trigger members_before_write before insert or update on public.members
  for each row execute function app.members_before_write();

-- 新會員自動產生 QR 密鑰
create or replace function app.members_after_insert() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into app.member_qr_keys (member_id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger members_after_insert after insert on public.members
  for each row execute function app.members_after_insert();

-- =====================================================================
-- D. 同意書規則
-- =====================================================================

-- 目前有效的同意書版本
create or replace function app.current_waiver_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from public.waiver_versions
  where effective_date <= app.today()
  order by effective_date desc, created_at desc
  limit 1
$$;

-- 會員是否已簽目前有效版本（尚未建立任何同意書時視為不需要）
create or replace function app.has_current_waiver(p_member uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.current_waiver_id() is null
      or exists (select 1 from public.waiver_signatures
                 where member_id = p_member and waiver_version_id = app.current_waiver_id())
$$;

-- 已有人簽過的版本，全文不可再改
create or replace function app.waiver_versions_before_update() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (new.content, new.version, new.title, new.effective_date)
     is distinct from (old.content, old.version, old.title, old.effective_date)
     and exists (select 1 from public.waiver_signatures where waiver_version_id = old.id) then
    raise exception '此版本已有會員簽署，內容不可修改，請建立新版本' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger waiver_versions_before_update before update on public.waiver_versions
  for each row execute function app.waiver_versions_before_update();

-- 簽署時自動判斷是否未成年、帶入經手人員與分館
create or replace function app.waiver_signatures_before_insert() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_birthday date;
begin
  select birthday into v_birthday from public.members where id = new.member_id;
  if v_birthday is null then
    raise exception '找不到會員' using errcode = 'P0002';
  end if;
  if auth.uid() is not null then new.signed_at := now(); end if;
  new.is_minor := (v_birthday + interval '18 years')::date > app.today();
  if new.is_minor and (coalesce(trim(new.guardian_name), '') = '' or coalesce(trim(new.guardian_phone), '') = ''
                       or coalesce(trim(new.guardian_relation), '') = '') then
    raise exception '會員未滿 18 歲，請填寫法定代理人姓名、電話與關係，並由法定代理人簽名'
      using errcode = '22023';
  end if;
  if app.is_staff() then
    new.staff_id := app.staff_id();
    new.branch_id := coalesce(new.branch_id, app.staff_branch_id());
  end if;
  return new;
end $$;

create trigger waiver_signatures_before_insert before insert on public.waiver_signatures
  for each row execute function app.waiver_signatures_before_insert();

create or replace function app.forbid_update() returns trigger
language plpgsql as $$
begin
  raise exception '「%」的資料建立後不可修改', tg_table_name using errcode = '42501';
end $$;

create trigger forbid_update before update on public.waiver_signatures
  for each row execute function app.forbid_update();
create trigger forbid_update before update on public.audit_logs
  for each row execute function app.forbid_update();

-- =====================================================================
-- E. 關帳鎖定與異動紀錄
-- =====================================================================

-- 已關帳的日子，櫃檯不能再新增或修改該日的訂單／明細／付款／退款
create or replace function app.enforce_day_lock() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_branch uuid; v_date date;
begin
  if auth.uid() is null or app.staff_role() in ('hq', 'manager') then
    return new;
  end if;
  -- 退款會把舊訂單標成「已退款」，但錢記在今天，所以允許
  if tg_table_name = 'orders' and current_setting('app.refunding', true) = 'on' then
    return new;
  end if;
  if tg_table_name in ('orders', 'refunds') then
    v_branch := new.branch_id; v_date := new.business_date;
  else
    select branch_id, business_date into v_branch, v_date from public.orders where id = new.order_id;
  end if;
  if app.day_closed(v_branch, v_date) then
    raise exception '% 已關帳，只有店長以上可以修改', v_date using errcode = '42501';
  end if;
  return new;
end $$;

create trigger enforce_day_lock before insert or update on public.orders
  for each row execute function app.enforce_day_lock();
create trigger enforce_day_lock before insert or update on public.order_items
  for each row execute function app.enforce_day_lock();
create trigger enforce_day_lock before insert or update on public.payments
  for each row execute function app.enforce_day_lock();
create trigger enforce_day_lock before insert on public.refunds
  for each row execute function app.enforce_day_lock();

-- 通用異動紀錄（修改前／修改後）
create or replace function app.audit_update() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_before jsonb := to_jsonb(old); v_after jsonb := to_jsonb(new); v_action text;
begin
  -- 結帳、入場、作廢、退款等功能自己會記錄，這裡不重複記
  if current_setting('app.system_write', true) = 'on' then return new; end if;
  if v_before - 'updated_at' = v_after - 'updated_at' then return new; end if;
  v_action := tg_argv[0];
  if tg_table_name = 'products' and (v_before -> 'price') is distinct from (v_after -> 'price') then
    v_action := 'product.price_changed';
  elsif tg_table_name = 'orders'
        and app.day_closed((v_after ->> 'branch_id')::uuid, (v_after ->> 'business_date')::date) then
    v_action := 'order.edited_after_closing';
  end if;
  perform app.audit(v_action, tg_table_name, new.id, (v_after ->> 'branch_id')::uuid, v_before, v_after);
  return new;
end $$;

create trigger audit_update after update on public.products
  for each row execute function app.audit_update('product.updated');
create trigger audit_update after update on public.orders
  for each row execute function app.audit_update('order.updated');
create trigger audit_update after update on public.member_plans
  for each row execute function app.audit_update('member_plan.updated');
create trigger audit_update after update on public.staff
  for each row execute function app.audit_update('staff.updated');

-- =====================================================================
-- F. 入場 QR code（30 秒動態碼，TOTP 標準，8 位數）
-- =====================================================================

create or replace function app.totp(p_secret bytea, p_step bigint) returns text
language plpgsql immutable as $$
declare h bytea; o int; bin bigint;
begin
  h := extensions.hmac(int8send(p_step), p_secret, 'sha1');
  o := get_byte(h, 19) & 15;
  bin := ((get_byte(h, o) & 127)::bigint << 24) | (get_byte(h, o + 1)::bigint << 16)
       | (get_byte(h, o + 2)::bigint << 8) | get_byte(h, o + 3)::bigint;
  return lpad((bin % 100000000)::text, 8, '0');
end $$;

create or replace function app.current_step() returns bigint
language sql stable as $$ select floor(extract(epoch from now()) / 30)::bigint $$;

-- 會員 App 取得自己的 QR 密鑰（App 用它每 30 秒自己算出新的碼，沒網路也能入場）
-- QR 內容格式：OY1.<會員編號>.<8 位數動態碼>
create or replace function public.get_my_qr_secret() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_member public.members; v_secret bytea;
begin
  select * into v_member from public.members where id = app.member_id();
  if v_member.id is null then
    raise exception '找不到會員資料' using errcode = '42501';
  end if;
  insert into app.member_qr_keys (member_id) values (v_member.id) on conflict do nothing;
  select secret into v_secret from app.member_qr_keys where member_id = v_member.id;
  return jsonb_build_object(
    'member_no', v_member.member_no,
    'secret_hex', encode(v_secret, 'hex'),
    'period', 30, 'digits', 8, 'algorithm', 'SHA1', 'prefix', 'OY1'
  );
end $$;

-- =====================================================================
-- G. 入場判斷
-- =====================================================================

-- 方案現在能不能在這個分館用；可以回傳 null，不行回傳原因
create or replace function app.plan_block_reason(p public.member_plans, p_branch uuid)
returns public.checkin_result
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_today date := app.today(); v_time time := app.now_tpe()::time;
begin
  if p.status in ('frozen', 'cancelled') then return 'no_valid_plan'; end if;
  if p.start_date is not null and p.start_date > v_today then return 'no_valid_plan'; end if;
  if p.end_date is not null and p.end_date < v_today then return 'plan_expired'; end if;
  if p.content_type <> 'days' and coalesce(p.remaining_count, 0) <= 0 then return 'no_remaining'; end if;
  if p.branch_ids is not null and not (p_branch = any (p.branch_ids)) then return 'branch_not_allowed'; end if;
  if p.usage_rule = 'weekday' and app.is_holiday(v_today) then return 'not_allowed_now'; end if;
  if p.usage_rule = 'weekend' and not app.is_holiday(v_today) then return 'not_allowed_now'; end if;
  if p.usage_rule = 'time_slot' and not (v_time >= p.slot_start and v_time < p.slot_end) then
    return 'not_allowed_now';
  end if;
  return null;
end $$;

create or replace function app.checkin_message(r public.checkin_result) returns text
language sql immutable as $$
  select case r
    when 'success'            then '入場成功，祝您攀爬愉快！'
    when 'qr_invalid'         then 'QR code 已失效，請重新整理 App 後再掃一次'
    when 'waiver_required'    then '請先至櫃檯簽署最新版同意書'
    when 'no_valid_plan'      then '目前沒有可使用的方案，請洽櫃檯'
    when 'plan_expired'       then '您的方案已到期，請洽櫃檯續約'
    when 'no_remaining'       then '您的次數已用完，請洽櫃檯購買'
    when 'not_allowed_now'    then '您的方案目前時段不適用，請洽櫃檯'
    when 'branch_not_allowed' then '您的方案不適用本分館，請洽櫃檯'
    when 'member_suspended'   then '會員資格暫停中，請洽櫃檯'
  end
$$;

-- 核心入場流程：檢查會員 → 同意書 → 方案 → 扣次 → 寫紀錄（同一個交易）
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
  v_reason public.checkin_result;
  v_result public.checkin_result;
  v_fallback public.checkin_result;
  v_deduct boolean := false;
  v_today_plan uuid;
  v_checkin uuid;
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

  if m.status <> 'active' then
    v_result := 'member_suspended';
  elsif not app.has_current_waiver(m.id) then
    v_result := 'waiver_required';
  elsif p_plan is not null then
    -- 櫃檯指定方案
    select * into v_plan from public.member_plans where id = p_plan and member_id = m.id for update;
    if v_plan.id is null then
      raise exception '此方案不屬於這位會員' using errcode = '22023';
    end if;
    v_reason := app.plan_block_reason(v_plan, p_branch);
    if v_reason is null then
      v_result := 'success';
      -- 課程每堂都扣；其他類型一天只扣一次
      v_deduct := v_plan.content_type = 'course' or (
        v_plan.content_type <> 'days' and not exists (
          select 1 from public.checkins
          where member_plan_id = v_plan.id and business_date = v_today
            and result = 'success' and deducted and cancelled_at is null));
    elsif v_reason = 'no_remaining' and v_plan.content_type <> 'course' and exists (
          select 1 from public.checkins
          where member_plan_id = v_plan.id and business_date = v_today
            and result = 'success' and deducted and cancelled_at is null) then
      v_result := 'success';  -- 今天已扣過，次數剛好用完仍可再進場
    else
      v_result := v_reason;
      v_plan := null;
    end if;
  else
    -- 今天已經成功入場過：沿用同一方案，不再扣次
    select c.member_plan_id into v_today_plan from public.checkins c
      join public.member_plans p on p.id = c.member_plan_id
      where c.member_id = m.id and c.business_date = v_today and c.result = 'success'
        and c.cancelled_at is null and p.content_type <> 'course'
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
          v_deduct := pl.content_type <> 'days';
          exit;
        end if;
        -- 記下最貼切的失敗原因：分館不符 > 時段不符 > 其他（以最新的方案為準）
        if v_reason = 'branch_not_allowed' then
          v_fallback := 'branch_not_allowed';
        elsif v_reason = 'not_allowed_now' and v_fallback is distinct from 'branch_not_allowed' then
          v_fallback := 'not_allowed_now';
        end if;
      end loop;

      if v_result is null then
        if v_fallback is null then
          select app.plan_block_reason(p, p_branch) into v_fallback
          from public.member_plans p
          where p.member_id = m.id and p.content_type in ('single', 'punch', 'days')
            and p.status in ('active', 'used_up', 'expired')
          order by p.created_at desc limit 1;
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
    'message', app.checkin_message(v_result),
    'checkin_id', v_checkin,
    'deducted', v_result = 'success' and v_deduct,
    'member', jsonb_build_object('id', m.id, 'member_no', m.member_no, 'name', m.name,
                                 'avatar_path', m.avatar_path),
    'plan', case when v_result = 'success' then jsonb_build_object(
              'id', v_plan.id, 'name', v_plan.name, 'content_type', v_plan.content_type,
              'remaining_count', v_plan.remaining_count, 'end_date', v_plan.end_date) end
  );
end $$;

-- 入場機：會員掃 QR code
create or replace function public.kiosk_checkin(p_qr text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d public.devices;
  v_parts text[];
  v_member public.members;
  v_key app.member_qr_keys;
  v_now bigint := app.current_step();
  v_step bigint;
  v_matched bigint;
  v_prev jsonb;
  v_res jsonb;
begin
  d := app.device();
  if d.id is null then
    raise exception '此裝置未授權為入場機' using errcode = '42501';
  end if;
  update public.devices set last_seen_at = now() where id = d.id;

  v_parts := string_to_array(trim(coalesce(p_qr, '')), '.');
  if array_length(v_parts, 1) = 3 and v_parts[1] = 'OY1' then
    select * into v_member from public.members where member_no = v_parts[2];
  end if;
  if v_member.id is not null then
    select * into v_key from app.member_qr_keys where member_id = v_member.id for update;
    -- 容許前後各 30 秒的手機時間誤差
    for v_step in v_now - 1 .. v_now + 1 loop
      if app.totp(v_key.secret, v_step) = v_parts[3] then v_matched := v_step; end if;
    end loop;
  end if;

  if v_matched is not null and v_matched <= v_key.last_used_step then
    -- 同一個碼再次被掃：若剛剛才在這裡成功入場（重複刷），直接回覆成功；否則視為截圖盜用
    select jsonb_build_object('checkin_id', c.id) into v_prev from public.checkins c
      where c.member_id = v_member.id and c.branch_id = d.branch_id and c.result = 'success'
        and c.cancelled_at is null and c.checked_in_at > now() - interval '90 seconds'
      order by c.checked_in_at desc limit 1;
    if v_prev is not null then
      return jsonb_build_object('result', 'success', 'message', app.checkin_message('success'),
        'repeated', true, 'checkin_id', v_prev ->> 'checkin_id', 'deducted', false,
        'member', jsonb_build_object('id', v_member.id, 'member_no', v_member.member_no,
                                     'name', v_member.name, 'avatar_path', v_member.avatar_path));
    end if;
    v_matched := null;
  end if;

  if v_matched is null then
    insert into public.checkins (member_id, branch_id, business_date, method, device_id, result)
    values (v_member.id, d.branch_id, app.today(), 'kiosk', d.id, 'qr_invalid');
    return jsonb_build_object('result', 'qr_invalid', 'message', app.checkin_message('qr_invalid'));
  end if;

  v_res := app.do_checkin(v_member.id, d.branch_id, 'kiosk', d.id, null);
  if v_res ->> 'result' = 'success' then
    update app.member_qr_keys set last_used_step = v_matched where member_id = v_member.id;
  end if;
  return v_res;
end $$;

-- 櫃檯：幫會員手動入場（可指定方案，例如課程）
create or replace function public.counter_checkin(
  p_member_id uuid, p_plan_id uuid default null, p_branch_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.staff; v_branch uuid;
begin
  s := app.require_staff(array['hq', 'manager', 'cashier']::public.staff_role[]);
  v_branch := case when s.role = 'hq' then p_branch_id else s.branch_id end;
  if v_branch is null then
    raise exception '請指定分館' using errcode = '22023';
  end if;
  return app.do_checkin(p_member_id, v_branch, 'counter', null, s.id, p_plan_id);
end $$;

-- 店長：取消一筆入場（誤刷），有扣次就退回
create or replace function public.cancel_checkin(p_checkin_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.staff; c public.checkins;
begin
  s := app.require_staff(array['hq', 'manager']::public.staff_role[]);
  select * into c from public.checkins where id = p_checkin_id for update;
  if c.id is null then raise exception '找不到入場紀錄' using errcode = 'P0002'; end if;
  if not app.can_manage_branch(c.branch_id) then
    raise exception '只能取消自己分館的入場紀錄' using errcode = '42501';
  end if;
  if c.cancelled_at is not null then raise exception '此筆入場已取消' using errcode = '22023'; end if;

  perform set_config('app.system_write', 'on', true);
  update public.checkins set cancelled_at = now(), cancelled_by = s.id where id = c.id;
  if c.deducted then
    update public.member_plans
      set remaining_count = remaining_count + 1,
          status = case when status = 'used_up' then 'active'::public.plan_status else status end
      where id = c.member_plan_id;
  end if;
  perform app.audit('checkin.cancelled', 'checkins', c.id, c.branch_id, to_jsonb(c), null);
end $$;

-- =====================================================================
-- H. 結帳（訂單＋明細＋付款＋會員方案，一起成功或一起失敗）
-- =====================================================================
-- 輸入範例：
-- {
--   "branch_id": "...",               -- 只有總部需要填
--   "member_id": "...",               -- 租借可不填
--   "sales_staff_id": "...",          -- 業務代表，選填
--   "items": [{"product_id": "...", "quantity": 1, "discount_amount": 0}],
--   "discount_amount": 0, "discount_reason": null,
--   "invoice_type": "carrier", "invoice_carrier": "/ABC1234", "invoice_tax_id": null,
--   "note": null,
--   "payments": [{"method": "cash", "amount": 500, "cash_received": 1000},
--                {"method": "line_pay", "amount": 300, "line_pay_transaction_id": "..."}]
-- }
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
    if pr.content_type <> 'rental' and v_member.id is null then
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

    if pr.content_type <> 'rental' then
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

-- =====================================================================
-- I. 作廢與退款
-- =====================================================================

-- 作廢：打錯單時使用。櫃檯只能作廢今天、尚未關帳的訂單；店長以上可作廢自己分館任何一天
create or replace function public.void_order(p_order_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.staff; o public.orders;
begin
  s := app.require_staff(array['hq', 'manager', 'cashier']::public.staff_role[]);
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception '請填寫作廢原因' using errcode = '22023';
  end if;
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null then raise exception '找不到訂單' using errcode = 'P0002'; end if;
  if not app.is_branch_staff(o.branch_id) then
    raise exception '只能作廢自己分館的訂單' using errcode = '42501';
  end if;
  if o.status <> 'paid' then raise exception '此訂單已作廢或已退款' using errcode = '22023'; end if;
  if s.role = 'cashier' and o.business_date <> app.today() then
    raise exception '櫃檯只能作廢今天的訂單，其他日期請改用退款或找店長' using errcode = '42501';
  end if;

  perform set_config('app.system_write', 'on', true);
  update public.orders set status = 'voided', voided_by = s.id, voided_at = now(), void_reason = p_reason
    where id = o.id;
  update public.member_plans set status = 'cancelled'
    where order_item_id in (select id from public.order_items where order_id = o.id);
  perform app.audit('order.voided', 'orders', o.id, o.branch_id, to_jsonb(o),
                    jsonb_build_object('status', 'voided', 'reason', p_reason));
end $$;

-- 退款：退錢給客人。記在今天的帳上；櫃檯與店長都可辦理（限自己分館）
create or replace function public.refund_order(
  p_order_id uuid, p_method public.payment_method, p_amount integer, p_reason text,
  p_line_pay_refund_id text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.staff; o public.orders; v_paid int; v_refund uuid;
begin
  s := app.require_staff(array['hq', 'manager', 'cashier']::public.staff_role[]);
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception '請填寫退款原因' using errcode = '22023';
  end if;
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null then raise exception '找不到訂單' using errcode = 'P0002'; end if;
  if not app.is_branch_staff(o.branch_id) then
    raise exception '只能退自己分館的訂單' using errcode = '42501';
  end if;
  if o.status <> 'paid' then raise exception '此訂單已作廢或已退款' using errcode = '22023'; end if;

  select coalesce(sum(amount), 0) into v_paid from public.payments where order_id = o.id;
  if p_amount is null or p_amount <= 0 or p_amount > v_paid then
    raise exception '退款金額需介於 1 到 % 元之間', v_paid using errcode = '22023';
  end if;

  insert into public.refunds (order_id, branch_id, business_date, method, amount,
                              line_pay_refund_id, reason, staff_id)
  values (o.id, o.branch_id, app.today(), p_method, p_amount,
          nullif(p_line_pay_refund_id, ''), p_reason, s.id)
  returning id into v_refund;

  perform set_config('app.system_write', 'on', true);
  perform set_config('app.refunding', 'on', true);
  update public.orders set status = 'refunded', voided_by = s.id, voided_at = now(), void_reason = p_reason
    where id = o.id;
  update public.member_plans set status = 'cancelled'
    where order_item_id in (select id from public.order_items where order_id = o.id);
  perform app.audit('order.refunded', 'refunds', v_refund, o.branch_id, null,
                    jsonb_build_object('order_no', o.order_no, 'amount', p_amount, 'method', p_method));
  return v_refund;
end $$;

-- =====================================================================
-- J. 關帳
-- =====================================================================

-- 關帳前預覽：系統算出今天應有多少錢
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
      'order_count', (select count(*) from public.orders
                      where branch_id = v_branch and business_date = v_date and status <> 'voided'),
      'cash_sales', coalesce(sum(pm.amount) filter (where pm.method = 'cash'), 0),
      'line_pay_sales', coalesce(sum(pm.amount) filter (where pm.method = 'line_pay'), 0),
      'cash_refunds', (select coalesce(sum(amount), 0) from public.refunds
                       where branch_id = v_branch and business_date = v_date and method = 'cash'),
      'line_pay_refunds', (select coalesce(sum(amount), 0) from public.refunds
                           where branch_id = v_branch and business_date = v_date and method = 'line_pay'),
      'checkin_count', (select count(*) from public.checkins
                        where branch_id = v_branch and business_date = v_date
                          and result = 'success' and cancelled_at is null),
      'is_closed', app.day_closed(v_branch, v_date))
    from public.payments pm
    join public.orders o on o.id = pm.order_id
    where o.branch_id = v_branch and o.business_date = v_date and o.status <> 'voided'
  );
end $$;

-- 關帳。櫃檯只能關今天；店長可關自己分館過去的日子；總部任何分館
create or replace function public.close_day(
  p_petty_cash integer, p_counted_cash integer, p_difference_note text default null,
  p_branch_id uuid default null, p_business_date date default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.staff; v_branch uuid; v_date date := coalesce(p_business_date, app.today());
  pv jsonb; v_expected int; v_existing public.daily_closings; v_row public.daily_closings;
begin
  s := app.require_staff(array['hq', 'manager', 'cashier']::public.staff_role[]);
  v_branch := case when s.role = 'hq' then p_branch_id else s.branch_id end;
  if v_branch is null then raise exception '請指定分館' using errcode = '22023'; end if;
  if s.role = 'cashier' and v_date <> app.today() then
    raise exception '櫃檯只能關今天的帳' using errcode = '42501';
  end if;
  if v_date > app.today() then raise exception '不能關未來日期的帳' using errcode = '22023'; end if;

  pv := public.closing_preview(v_branch, v_date);
  v_expected := p_petty_cash + (pv ->> 'cash_sales')::int - (pv ->> 'cash_refunds')::int;

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
    insert into public.daily_closings (branch_id, business_date, petty_cash, cash_sales, line_pay_sales,
        cash_refunds, expected_cash, counted_cash, difference, difference_note, closed_by)
    values (v_branch, v_date, p_petty_cash, (pv ->> 'cash_sales')::int, (pv ->> 'line_pay_sales')::int,
        (pv ->> 'cash_refunds')::int, v_expected, p_counted_cash, p_counted_cash - v_expected,
        nullif(trim(p_difference_note), ''), s.id)
    returning * into v_row;
  else
    -- 重新開帳後再次關帳
    update public.daily_closings set petty_cash = p_petty_cash,
        cash_sales = (pv ->> 'cash_sales')::int, line_pay_sales = (pv ->> 'line_pay_sales')::int,
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

-- 重新開帳（店長以上）
create or replace function public.reopen_day(
  p_business_date date, p_reason text, p_branch_id uuid default null
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.staff; v_branch uuid; c public.daily_closings;
begin
  s := app.require_staff(array['hq', 'manager']::public.staff_role[]);
  v_branch := case when s.role = 'hq' then p_branch_id else s.branch_id end;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception '請填寫重新開帳原因' using errcode = '22023';
  end if;
  select * into c from public.daily_closings
    where branch_id = v_branch and business_date = p_business_date and reopened_at is null for update;
  if c.id is null then raise exception '這一天尚未關帳' using errcode = '22023'; end if;
  update public.daily_closings set reopened_by = s.id, reopened_at = now() where id = c.id;
  perform app.audit('closing.reopened', 'daily_closings', c.id, v_branch, to_jsonb(c),
                    jsonb_build_object('reason', p_reason));
end $$;

-- =====================================================================
-- K. 會員 App 專用
-- =====================================================================

-- 我的資料（不含櫃檯備註），附帶是否需要簽同意書
create or replace function public.get_my_profile() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select case when m.id is null then null else
    (to_jsonb(m) - 'staff_note' - 'auth_user_id' - 'created_by_staff_id' - 'legacy_17fit_id')
    || jsonb_build_object('waiver_required', not app.has_current_waiver(m.id),
                          'current_waiver_id', app.current_waiver_id())
  end
  from (select 1) x left join public.members m on m.id = app.member_id()
$$;

-- 會員自行註冊（簡訊驗證登入後，若尚無會員資料）
create or replace function public.register_me(
  p_name text, p_birthday date, p_home_branch_id uuid,
  p_emergency_name text, p_emergency_phone text, p_emergency_relation text,
  p_email text default null, p_carrier_code text default null, p_marketing_opt_in boolean default false
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_phone text; v_id uuid;
begin
  if auth.uid() is null then raise exception '請先登入' using errcode = '42501'; end if;
  if app.member_id() is not null then raise exception '您已經是會員了' using errcode = '22023'; end if;
  select phone into v_phone from auth.users where id = auth.uid();
  if coalesce(v_phone, '') = '' then
    raise exception '請使用手機簡訊登入後再註冊' using errcode = '42501';
  end if;
  insert into public.members (auth_user_id, phone, name, birthday, home_branch_id,
      emergency_name, emergency_phone, emergency_relation, email, carrier_code, marketing_opt_in)
  values (auth.uid(), v_phone, p_name, p_birthday, p_home_branch_id,
      p_emergency_name, p_emergency_phone, p_emergency_relation, p_email, p_carrier_code,
      coalesce(p_marketing_opt_in, false))
  returning id into v_id;
  return public.get_my_profile();
end $$;

-- 會員修改自己的資料（手機號碼不能改）
create or replace function public.update_my_profile(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := app.member_id();
begin
  if v_id is null then raise exception '找不到會員資料' using errcode = '42501'; end if;
  if p ? 'phone' then raise exception '手機號碼請洽櫃檯由總部修改' using errcode = '42501'; end if;
  update public.members set
    email              = case when p ? 'email' then p ->> 'email' else email end,
    avatar_path        = case when p ? 'avatar_path' then p ->> 'avatar_path' else avatar_path end,
    carrier_code       = case when p ? 'carrier_code' then p ->> 'carrier_code' else carrier_code end,
    emergency_name     = coalesce(p ->> 'emergency_name', emergency_name),
    emergency_phone    = coalesce(p ->> 'emergency_phone', emergency_phone),
    emergency_relation = coalesce(p ->> 'emergency_relation', emergency_relation),
    marketing_opt_in   = coalesce((p ->> 'marketing_opt_in')::boolean, marketing_opt_in)
  where id = v_id;
  return public.get_my_profile();
end $$;
