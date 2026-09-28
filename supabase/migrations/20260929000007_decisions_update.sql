-- =====================================================================
-- 原岩攀岩館 會員與櫃檯系統
-- 第 7 部分：依 docs/decisions.md、設計稿與老闆 2026-09-29 的回覆調整
--   1. 分館設定：品牌名稱（例：T-UP）、固定零用金、入場機音量
--   2. 同意書：三個勾選紀錄、未成年時法定代理人另外簽名
--   3. QR code 可以指定方案（掃描時扣該方案）；櫃檯可用掃碼器找會員
--   4. 入場機只有四種畫面：回傳 screen（ok／expired／waiver／invalid）與被擋下的方案
--   5. 退款限店長以上；櫃檯只能作廢當日訂單（原本就是）
--   6. 店長可新增、修改只在自己分館販售的品項
--   7. 方案異動（暫停、恢復、延期、轉讓）限店長以上
--   8. 關帳顯示品項銷售；零用金改用分館固定金額
--   9. 會員不能在 App 自行註冊（第一次須到櫃檯）
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 分館設定
-- ---------------------------------------------------------------------
alter table public.branches
  add column brand_label text,
  add column petty_cash_default integer not null default 0 check (petty_cash_default >= 0),
  add column kiosk_volume integer not null default 80 check (kiosk_volume between 0 and 100);
comment on column public.branches.brand_label is '分館品牌名稱，顯示在店名後面（例：中和店 T-UP）';
comment on column public.branches.petty_cash_default is '固定零用金（元），總部後台設定，關帳時自動帶入';
comment on column public.branches.kiosk_volume is '入場機提示音音量 0～100';

update public.branches set brand_label = 'T-UP' where code = 'ZH';

-- ---------------------------------------------------------------------
-- 2. 同意書：三個勾選＋法定代理人簽名
-- ---------------------------------------------------------------------
alter table public.waiver_signatures
  add column agree_risk boolean not null default false,
  add column agree_health boolean not null default false,
  add column agree_privacy boolean not null default false,
  add column guardian_signature_path text;
comment on column public.waiver_signatures.agree_risk is '已閱讀並了解攀岩運動的風險與場館規則';
comment on column public.waiver_signatures.agree_health is '確認目前身體狀況適合從事攀岩（自我聲明，不記錄病史）';
comment on column public.waiver_signatures.agree_privacy is '已閱讀個人資料蒐集告知事項';
comment on column public.waiver_signatures.signature_path is '會員本人簽名圖檔';
comment on column public.waiver_signatures.guardian_signature_path is '法定代理人簽名圖檔（未成年時必填）';

-- 新簽署的紀錄必須三項都勾選；未成年必須有法定代理人簽名（舊紀錄不檢查）
alter table public.waiver_signatures
  add constraint consents_required check (agree_risk and agree_health and agree_privacy) not valid,
  add constraint guardian_signature_required check (not is_minor or guardian_signature_path is not null) not valid;

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
  if not (new.agree_risk and new.agree_health and new.agree_privacy) then
    raise exception '請勾選全部三個確認項目' using errcode = '22023';
  end if;
  if new.is_minor and (coalesce(trim(new.guardian_name), '') = '' or coalesce(trim(new.guardian_phone), '') = ''
                       or coalesce(trim(new.guardian_relation), '') = '' or new.guardian_signature_path is null) then
    raise exception '會員未滿 18 歲，請填寫法定代理人姓名、電話與關係，並由法定代理人一起簽名'
      using errcode = '22023';
  end if;
  if app.is_staff() then
    new.staff_id := app.staff_id();
    new.branch_id := coalesce(new.branch_id, app.staff_branch_id());
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 3、4. 入場：QR 可指定方案；入場機畫面對應
-- ---------------------------------------------------------------------

-- 入場機只有四種畫面。次數用完、分館不適用、沒有方案、時段不適用、會員暫停都顯示「暫時無法入場」
create or replace function app.checkin_screen(r public.checkin_result) returns text
language sql immutable as $$
  select case r
    when 'success' then 'ok'
    when 'waiver_required' then 'waiver'
    when 'qr_invalid' then 'invalid'
    else 'expired'
  end
$$;

alter table public.member_plans add column frozen_at date;
comment on column public.member_plans.frozen_at is '暫停開始日（恢復時依暫停天數延長到期日）';

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

  -- 今天是否已經扣過次（一天只扣一次；課程不算）
  select exists (
    select 1 from public.checkins c join public.member_plans p on p.id = c.member_plan_id
    where c.member_id = m.id and c.business_date = v_today and c.result = 'success'
      and c.deducted and c.cancelled_at is null and p.content_type <> 'course'
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
      -- 課程每堂都扣；天數型不扣；其他一天只扣一次
      v_deduct := v_plan.content_type = 'course'
               or (v_plan.content_type <> 'days' and not v_paid_today);
    elsif v_reason = 'no_remaining' and v_plan.content_type <> 'course' and v_paid_today then
      v_result := 'success';  -- 今天已扣過，次數剛好用完仍可再進場
    else
      v_result := v_reason;
      v_blocked := v_plan;
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
          v_deduct := pl.content_type <> 'days' and not v_paid_today;
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

-- 解析並驗證 QR：OY1.<會員編號>.<8 位動態碼>[.<方案 id>]
-- 回傳 member、plan_id、matched_step；驗證失敗時 member 為空
create or replace function app.parse_member_qr(p_qr text, out member public.members,
                                               out plan_id uuid, out matched_step bigint, out last_used_step bigint)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_parts text[] := string_to_array(trim(coalesce(p_qr, '')), '.');
  v_key app.member_qr_keys;
  v_now bigint := app.current_step();
  v_step bigint;
begin
  if array_length(v_parts, 1) not in (3, 4) or v_parts[1] <> 'OY1' then return; end if;
  select * into member from public.members where member_no = v_parts[2];
  if member.id is null then return; end if;
  if array_length(v_parts, 1) = 4 then
    begin
      plan_id := v_parts[4]::uuid;
    exception when others then
      member := null; return;
    end;
  end if;
  select * into v_key from app.member_qr_keys where member_id = member.id;
  last_used_step := v_key.last_used_step;
  -- 容許前後各 30 秒的手機時間誤差
  for v_step in v_now - 1 .. v_now + 1 loop
    if app.totp(v_key.secret, v_step) = v_parts[3] then matched_step := v_step; end if;
  end loop;
end $$;

-- 入場機：會員掃 QR code
create or replace function public.kiosk_checkin(p_qr text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d public.devices;
  q record;
  v_prev jsonb;
  v_res jsonb;
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
             'remaining_count', p.remaining_count, 'end_date', p.end_date)) into v_prev
      from public.checkins c left join public.member_plans p on p.id = c.member_plan_id
      where c.member_id = (q.member).id and c.branch_id = d.branch_id and c.result = 'success'
        and c.cancelled_at is null and c.checked_in_at > now() - interval '90 seconds'
      order by c.checked_in_at desc limit 1;
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

-- 櫃檯：掃碼器掃到會員 QR 時，找出是哪位會員（不入場、不扣次）
create or replace function public.resolve_member_qr(p_qr text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare q record;
begin
  perform app.require_staff(array['hq', 'manager', 'cashier']::public.staff_role[]);
  select * into q from app.parse_member_qr(p_qr);
  if q.matched_step is null then
    return jsonb_build_object('ok', false, 'message', 'QR code 已失效，請會員重新打開 App');
  end if;
  return jsonb_build_object('ok', true, 'member_id', (q.member).id, 'plan_id', q.plan_id);
end $$;

-- ---------------------------------------------------------------------
-- 5. 退款限店長以上
-- ---------------------------------------------------------------------
create or replace function public.refund_order(
  p_order_id uuid, p_method public.payment_method, p_amount integer, p_reason text,
  p_line_pay_refund_id text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.staff; o public.orders; v_paid int; v_refund uuid;
begin
  s := app.require_staff(array['hq', 'manager']::public.staff_role[]);
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception '請填寫退款原因' using errcode = '22023';
  end if;
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null then raise exception '找不到訂單' using errcode = 'P0002'; end if;
  if not app.can_manage_branch(o.branch_id) then
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

-- ---------------------------------------------------------------------
-- 6. 店長可管理「只在自己分館販售」的品項（總部可管理全部；分類仍只有總部能改）
-- ---------------------------------------------------------------------

-- 品項是否只屬於某分館（沒有設定其他分館）
create or replace function app.product_only_in_branch(p_product uuid, p_branch uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select not p.all_branches
     and not exists (select 1 from public.product_branches pb
                     where pb.product_id = p.id and pb.branch_id <> p_branch)
  from public.products p where p.id = p_product
$$;
grant execute on function app.product_only_in_branch(uuid, uuid) to authenticated;

create policy products_manager_insert on public.products for insert to authenticated
  with check (app.staff_role() = 'manager' and not all_branches);
create policy products_manager_update on public.products for update to authenticated
  using (app.staff_role() = 'manager' and app.product_only_in_branch(id, app.staff_branch_id()))
  with check (app.staff_role() = 'manager' and not all_branches);
create policy product_branches_manager_insert on public.product_branches for insert to authenticated
  with check (app.staff_role() = 'manager' and branch_id = app.staff_branch_id()
              and app.product_only_in_branch(product_id, app.staff_branch_id()));
create policy product_branches_manager_delete on public.product_branches for delete to authenticated
  using (app.staff_role() = 'manager' and branch_id = app.staff_branch_id()
         and app.product_only_in_branch(product_id, app.staff_branch_id()));

-- 分館設定（固定零用金、入場機音量、品牌名稱）沿用原本權限：只有總部能改

-- ---------------------------------------------------------------------
-- 7. 方案異動（店長以上，限自己分館的會員或自己分館賣出的方案）
-- ---------------------------------------------------------------------
create or replace function app.require_plan_manager(p_plan uuid) returns public.member_plans
language plpgsql security definer set search_path = public, pg_temp as $$
declare pl public.member_plans; v_order_branch uuid; v_home uuid;
begin
  perform app.require_staff(array['hq', 'manager']::public.staff_role[]);
  select * into pl from public.member_plans where id = p_plan for update;
  if pl.id is null then raise exception '找不到方案' using errcode = 'P0002'; end if;
  select o.branch_id into v_order_branch from public.order_items oi join public.orders o on o.id = oi.order_id
    where oi.id = pl.order_item_id;
  select home_branch_id into v_home from public.members where id = pl.member_id;
  if not (app.can_manage_branch(v_home) or (v_order_branch is not null and app.can_manage_branch(v_order_branch))) then
    raise exception '只能異動自己分館的會員或自己分館賣出的方案' using errcode = '42501';
  end if;
  return pl;
end $$;

-- 暫停：暫停期間不能入場；恢復時依暫停天數延長到期日
create or replace function public.freeze_plan(p_plan_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare pl public.member_plans;
begin
  pl := app.require_plan_manager(p_plan_id);
  if pl.status <> 'active' then raise exception '只有使用中的方案可以暫停' using errcode = '22023'; end if;
  perform set_config('app.system_write', 'on', true);
  update public.member_plans set status = 'frozen', frozen_at = app.today() where id = pl.id;
  perform app.audit('member_plan.frozen', 'member_plans', pl.id, null, to_jsonb(pl), jsonb_build_object('reason', p_reason));
end $$;

create or replace function public.unfreeze_plan(p_plan_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare pl public.member_plans; v_days int;
begin
  pl := app.require_plan_manager(p_plan_id);
  if pl.status <> 'frozen' then raise exception '這個方案沒有在暫停中' using errcode = '22023'; end if;
  v_days := greatest(app.today() - coalesce(pl.frozen_at, app.today()), 0);
  perform set_config('app.system_write', 'on', true);
  update public.member_plans
    set status = 'active', frozen_at = null,
        end_date = case when end_date is not null then end_date + v_days end
    where id = pl.id;
  perform app.audit('member_plan.unfrozen', 'member_plans', pl.id, null, to_jsonb(pl),
                    jsonb_build_object('extended_days', v_days));
end $$;

-- 延期：到期日往後延 N 天
create or replace function public.extend_plan(p_plan_id uuid, p_days integer, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare pl public.member_plans;
begin
  pl := app.require_plan_manager(p_plan_id);
  if p_days is null or p_days < 1 then raise exception '延期天數至少 1 天' using errcode = '22023'; end if;
  if pl.end_date is null then raise exception '這個方案沒有到期日，不需要延期' using errcode = '22023'; end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception '請填寫延期原因' using errcode = '22023'; end if;
  perform set_config('app.system_write', 'on', true);
  update public.member_plans
    set end_date = end_date + p_days,
        status = case when status = 'expired' and end_date + p_days >= app.today() then 'active'::public.plan_status else status end
    where id = pl.id;
  perform app.audit('member_plan.extended', 'member_plans', pl.id, null, to_jsonb(pl),
                    jsonb_build_object('days', p_days, 'reason', p_reason));
end $$;

-- 轉讓：把方案（剩餘次數或天數）轉給另一位會員
create or replace function public.transfer_plan(p_plan_id uuid, p_to_member_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare pl public.member_plans;
begin
  pl := app.require_plan_manager(p_plan_id);
  if pl.status not in ('active', 'frozen') then raise exception '只有使用中或暫停中的方案可以轉讓' using errcode = '22023'; end if;
  if pl.member_id = p_to_member_id then raise exception '不能轉讓給同一位會員' using errcode = '22023'; end if;
  if not exists (select 1 from public.members where id = p_to_member_id and status = 'active') then
    raise exception '找不到要轉入的會員，或該會員不是正常狀態' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception '請填寫轉讓原因' using errcode = '22023'; end if;
  perform set_config('app.system_write', 'on', true);
  update public.member_plans
    set member_id = p_to_member_id,
        note = concat_ws('；', note, '由會員轉讓（' || app.today() || '）')
    where id = pl.id;
  perform app.audit('member_plan.transferred', 'member_plans', pl.id, null, to_jsonb(pl),
                    jsonb_build_object('to_member_id', p_to_member_id, 'reason', p_reason));
end $$;

-- ---------------------------------------------------------------------
-- 8. 關帳：品項銷售、固定零用金
-- ---------------------------------------------------------------------
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

-- 零用金不傳時，使用分館設定的固定金額
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
    insert into public.daily_closings (branch_id, business_date, petty_cash, cash_sales, line_pay_sales,
        cash_refunds, expected_cash, counted_cash, difference, difference_note, closed_by)
    values (v_branch, v_date, v_petty, (pv ->> 'cash_sales')::int, (pv ->> 'line_pay_sales')::int,
        (pv ->> 'cash_refunds')::int, v_expected, p_counted_cash, p_counted_cash - v_expected,
        nullif(trim(p_difference_note), ''), s.id)
    returning * into v_row;
  else
    update public.daily_closings set petty_cash = v_petty,
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

-- ---------------------------------------------------------------------
-- 9. 會員不能在 App 自行註冊
-- ---------------------------------------------------------------------
revoke execute on function public.register_me(text, date, uuid, text, text, text, text, text, boolean) from authenticated;

-- ---------------------------------------------------------------------
-- 權限：新功能只給登入者呼叫（函式內部會再檢查身分）
-- ---------------------------------------------------------------------
revoke all on function app.checkin_screen(public.checkin_result) from public;
revoke all on function app.parse_member_qr(text) from public;
revoke all on function app.require_plan_manager(uuid) from public;
revoke all on function public.resolve_member_qr(text) from public, anon;
revoke all on function public.freeze_plan(uuid, text) from public, anon;
revoke all on function public.unfreeze_plan(uuid) from public, anon;
revoke all on function public.extend_plan(uuid, integer, text) from public, anon;
revoke all on function public.transfer_plan(uuid, uuid, text) from public, anon;
grant execute on function
  public.resolve_member_qr(text),
  public.freeze_plan(uuid, text),
  public.unfreeze_plan(uuid),
  public.extend_plan(uuid, integer, text),
  public.transfer_plan(uuid, uuid, text)
  to authenticated;
