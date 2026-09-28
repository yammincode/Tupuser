-- =====================================================================
-- 原岩攀岩館 會員與櫃檯系統
-- 第 1 部分：資料表結構
-- 對應文件：docs/database.md
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- 內部用 schema：放輔助函式與不對外公開的資料（不會出現在 API 上）
create schema if not exists app;

-- ---------------------------------------------------------------------
-- 共用小工具
-- ---------------------------------------------------------------------

-- 台灣現在時間（不含時區的時間，用來判斷平日／假日／時段）
create or replace function app.now_tpe() returns timestamp
language sql stable as $$ select now() at time zone 'Asia/Taipei' $$;

-- 台灣今天日期（營業日）
create or replace function app.today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Taipei')::date $$;

-- 把手機號碼統一成 +8869XXXXXXXX
create or replace function app.normalize_phone(p text) returns text
language plpgsql immutable as $$
declare d text;
begin
  if p is null then return null; end if;
  d := regexp_replace(p, '[^0-9+]', '', 'g');
  if d ~ '^09[0-9]{8}$' then return '+886' || substr(d, 2); end if;
  if d ~ '^8869[0-9]{8}$' then return '+' || d; end if;
  if d ~ '^\+8869[0-9]{8}$' then return d; end if;
  raise exception '手機號碼格式不正確：%', p using errcode = '22023';
end $$;

-- 自動更新 updated_at
create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- 禁止刪除（品項、訂單、紀錄類資料一律不能刪）
create or replace function app.forbid_delete() returns trigger
language plpgsql as $$
begin
  raise exception '「%」的資料不可刪除，請改用狀態欄位（下架／停用／作廢）', tg_table_name
    using errcode = '42501';
end $$;

-- ---------------------------------------------------------------------
-- 列舉型別（固定選項）
-- ---------------------------------------------------------------------
create type public.staff_role     as enum ('hq', 'manager', 'cashier');
create type public.active_status  as enum ('active', 'disabled');
create type public.device_type    as enum ('kiosk', 'counter');
create type public.member_status  as enum ('active', 'suspended', 'inactive');
create type public.waiver_method  as enum ('counter', 'app', 'paper');
create type public.content_type   as enum ('single', 'punch', 'days', 'course', 'rental');
create type public.usage_rule     as enum ('any', 'weekday', 'weekend', 'time_slot');
create type public.product_status as enum ('on_sale', 'off_sale');
create type public.plan_status    as enum ('active', 'used_up', 'expired', 'frozen', 'cancelled');
create type public.order_status   as enum ('paid', 'voided', 'refunded');
create type public.invoice_type   as enum ('carrier', 'print');
create type public.payment_method as enum ('cash', 'line_pay');
create type public.checkin_method as enum ('kiosk', 'counter');
create type public.checkin_result as enum (
  'success', 'qr_invalid', 'waiver_required', 'no_valid_plan', 'plan_expired',
  'no_remaining', 'not_allowed_now', 'branch_not_allowed', 'member_suspended'
);

-- =====================================================================
-- 1. 組織
-- =====================================================================

create table public.branches (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-Z0-9]{2,6}$'),
  name        text not null,
  address     text,
  phone       text,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.branches is '分館';

create table public.staff (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid unique references auth.users(id) on delete set null,
  name          text not null,
  email         text not null unique,
  phone         text,
  role          public.staff_role not null,
  branch_id     uuid references public.branches(id),
  status        public.active_status not null default 'active',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint staff_branch_required check (role = 'hq' or branch_id is not null)
);
comment on table public.staff is '員工（總部／店長／櫃檯）';
create index on public.staff (branch_id);

create table public.devices (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid unique references auth.users(id) on delete set null,
  email         text not null unique,
  branch_id     uuid not null references public.branches(id),
  name          text not null,
  type          public.device_type not null default 'kiosk',
  status        public.active_status not null default 'active',
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.devices is '裝置（入場機、櫃檯平板），用獨立帳號登入';

-- 國定假日（「假日」方案在這些日子也可使用；週六、週日自動算假日）
create table public.holidays (
  date        date primary key,
  name        text not null,
  created_at  timestamptz not null default now()
);
comment on table public.holidays is '國定假日（由總部維護）';

-- =====================================================================
-- 2. 會員
-- =====================================================================

create sequence public.member_no_seq start 1;

create table public.members (
  id                   uuid primary key default gen_random_uuid(),
  member_no            text not null unique
                       default 'M' || lpad(nextval('public.member_no_seq')::text, 6, '0'),
  auth_user_id         uuid unique references auth.users(id) on delete set null,
  phone                text not null unique check (phone ~ '^\+8869[0-9]{8}$'),
  name                 text not null check (length(trim(name)) > 0),
  birthday             date not null check (birthday > '1900-01-01'),
  avatar_path          text,
  emergency_name       text not null,
  emergency_phone      text not null,
  emergency_relation   text not null,
  carrier_code         text check (carrier_code ~ '^/[0-9A-Z.+-]{7}$'),
  email                text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  home_branch_id       uuid not null references public.branches(id),
  status               public.member_status not null default 'active',
  staff_note           text,
  legacy_17fit_id      text unique,
  marketing_opt_in     boolean not null default false,
  marketing_opt_in_at  timestamptz,
  created_by_staff_id  uuid references public.staff(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
comment on table public.members is '會員（不收身分證字號與病史）';
comment on column public.members.staff_note is '櫃檯備註，會員本人看不到';
create index members_name_idx on public.members (name);
create index members_home_branch_idx on public.members (home_branch_id);

-- 入場 QR 密鑰：放在內部 schema，API 完全讀不到
create table app.member_qr_keys (
  member_id       uuid primary key references public.members(id),
  secret          bytea not null default extensions.gen_random_bytes(20),
  last_used_step  bigint not null default 0,
  rotated_at      timestamptz not null default now()
);
comment on table app.member_qr_keys is '會員 30 秒動態 QR 的密鑰';

-- =====================================================================
-- 3. 同意書
-- =====================================================================

create table public.waiver_versions (
  id              uuid primary key default gen_random_uuid(),
  version         text not null unique,
  title           text not null,
  content         text not null,
  effective_date  date not null,
  created_by      uuid references public.staff(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on table public.waiver_versions is '同意書版本；有人簽過後全文不可修改';
create index on public.waiver_versions (effective_date desc);

create table public.waiver_signatures (
  id                  uuid primary key default gen_random_uuid(),
  member_id           uuid not null references public.members(id),
  waiver_version_id   uuid not null references public.waiver_versions(id),
  signed_at           timestamptz not null default now(),
  branch_id           uuid references public.branches(id),
  method              public.waiver_method not null,
  signature_path      text not null,
  is_minor            boolean not null default false,
  guardian_name       text,
  guardian_phone      text,
  guardian_relation   text,
  staff_id            uuid references public.staff(id),
  created_at          timestamptz not null default now(),
  constraint guardian_required check (
    not is_minor or (guardian_name is not null and guardian_phone is not null
                     and guardian_relation is not null)
  )
);
comment on table public.waiver_signatures is '同意書簽署紀錄（法律證據，不可修改或刪除）';
create index on public.waiver_signatures (member_id, waiver_version_id);

-- =====================================================================
-- 4. 品項
-- =====================================================================

create table public.product_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  bg_color    text not null default '#E5E7EB' check (bg_color ~ '^#[0-9A-Fa-f]{6}$'),
  text_color  text not null default '#111827' check (text_color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.product_categories is '品項分類（櫃檯按鈕格子顏色）';

create table public.products (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  category_id   uuid not null references public.product_categories(id),
  price         integer not null check (price >= 0),
  content_type  public.content_type not null,
  quantity      integer not null check (quantity >= 1),
  valid_days    integer check (valid_days is null or valid_days >= 1),
  usage_rule    public.usage_rule not null default 'any',
  slot_start    time,
  slot_end      time,
  all_branches  boolean not null default true,
  sort_order    integer not null default 0,
  sale_start    date,
  sale_end      date,
  status        public.product_status not null default 'on_sale',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint single_rental_qty check (content_type not in ('single', 'rental') or quantity = 1),
  constraint slot_required check (
    usage_rule <> 'time_slot' or (slot_start is not null and slot_end is not null and slot_start < slot_end)
  ),
  constraint sale_period check (sale_start is null or sale_end is null or sale_start <= sale_end)
);
comment on table public.products is '品項（不可刪除，只能上架／下架）';
create index on public.products (category_id, sort_order);

create table public.product_branches (
  product_id  uuid not null references public.products(id),
  branch_id   uuid not null references public.branches(id),
  primary key (product_id, branch_id)
);
comment on table public.product_branches is '品項適用分館（products.all_branches = false 時使用）';

-- =====================================================================
-- 6. 銷售（先建訂單，會員方案要參照 order_items）
-- =====================================================================

create table public.orders (
  id                uuid primary key default gen_random_uuid(),
  order_no          text not null unique,
  branch_id         uuid not null references public.branches(id),
  business_date     date not null,
  member_id         uuid references public.members(id),
  cashier_staff_id  uuid not null references public.staff(id),
  sales_staff_id    uuid references public.staff(id),
  subtotal          integer not null check (subtotal >= 0),
  discount_amount   integer not null default 0 check (discount_amount >= 0),
  discount_reason   text,
  total             integer not null check (total >= 0),
  invoice_type      public.invoice_type not null,
  invoice_carrier   text,
  invoice_tax_id    text check (invoice_tax_id is null or invoice_tax_id ~ '^[0-9]{8}$'),
  invoice_no        text,
  note              text,
  status            public.order_status not null default 'paid',
  voided_by         uuid references public.staff(id),
  voided_at         timestamptz,
  void_reason       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint total_matches check (total = subtotal - discount_amount),
  constraint carrier_required check (invoice_type <> 'carrier' or invoice_carrier is not null)
);
comment on table public.orders is '訂單（不可刪除；打錯用作廢、退錢用退款）';
create index on public.orders (branch_id, business_date);
create index on public.orders (member_id);

create table public.order_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.orders(id),
  product_id       uuid not null references public.products(id),
  product_name     text not null,
  unit_price       integer not null check (unit_price >= 0),
  quantity         integer not null check (quantity >= 1),
  discount_amount  integer not null default 0 check (discount_amount >= 0),
  line_total       integer not null check (line_total >= 0),
  created_at       timestamptz not null default now(),
  constraint line_total_matches check (line_total = unit_price * quantity - discount_amount)
);
comment on table public.order_items is '訂單明細（保存當下品名與單價）';
create index on public.order_items (order_id);

create table public.payments (
  id                       uuid primary key default gen_random_uuid(),
  order_id                 uuid not null references public.orders(id),
  method                   public.payment_method not null,
  amount                   integer not null check (amount > 0),
  cash_received            integer,
  cash_change              integer,
  line_pay_transaction_id  text,
  status                   text not null default 'completed' check (status = 'completed'),
  paid_at                  timestamptz not null default now(),
  created_at               timestamptz not null default now(),
  constraint cash_fields check (
    method <> 'cash' or cash_received is null
    or (cash_received >= amount and cash_change = cash_received - amount)
  )
);
comment on table public.payments is '付款（現金／LINE Pay）';
create index on public.payments (order_id);

create table public.refunds (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references public.orders(id),
  branch_id           uuid not null references public.branches(id),
  business_date       date not null,
  method              public.payment_method not null,
  amount              integer not null check (amount > 0),
  line_pay_refund_id  text,
  reason              text not null check (length(trim(reason)) > 0),
  staff_id            uuid not null references public.staff(id),
  refunded_at         timestamptz not null default now(),
  created_at          timestamptz not null default now()
);
comment on table public.refunds is '退款（記在退款當天的帳上）';
create index on public.refunds (branch_id, business_date);
create index on public.refunds (order_id);

-- =====================================================================
-- 5. 會員方案
-- =====================================================================

create table public.member_plans (
  id               uuid primary key default gen_random_uuid(),
  member_id        uuid not null references public.members(id),
  product_id       uuid not null references public.products(id),
  order_item_id    uuid references public.order_items(id),
  name             text not null,
  content_type     public.content_type not null check (content_type <> 'rental'),
  total_count      integer check (total_count is null or total_count >= 0),
  remaining_count  integer check (remaining_count is null or remaining_count >= 0),
  start_date       date,
  end_date         date,
  usage_rule       public.usage_rule not null default 'any',
  slot_start       time,
  slot_end         time,
  branch_ids       uuid[],
  status           public.plan_status not null default 'active',
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint count_types_have_count check (
    content_type = 'days' or (total_count is not null and remaining_count is not null)
  ),
  constraint dates_order check (start_date is null or end_date is null or start_date <= end_date)
);
comment on table public.member_plans is '會員方案（購買當下的條件快照）';
comment on column public.member_plans.branch_ids is '適用分館快照；空白 = 所有分館';
create index on public.member_plans (member_id, status);
create index on public.member_plans (order_item_id);

-- =====================================================================
-- 7. 入場
-- =====================================================================

create table public.checkins (
  id              uuid primary key default gen_random_uuid(),
  member_id       uuid references public.members(id),
  member_plan_id  uuid references public.member_plans(id),
  branch_id       uuid not null references public.branches(id),
  checked_in_at   timestamptz not null default now(),
  business_date   date not null,
  method          public.checkin_method not null,
  device_id       uuid references public.devices(id),
  staff_id        uuid references public.staff(id),
  result          public.checkin_result not null,
  deducted        boolean not null default false,
  cancelled_at    timestamptz,
  cancelled_by    uuid references public.staff(id),
  created_at      timestamptz not null default now(),
  constraint success_has_plan check (result <> 'success' or member_plan_id is not null),
  constraint counter_has_staff check (method <> 'counter' or staff_id is not null)
);
comment on table public.checkins is '入場紀錄（成功與被擋下都記）';
comment on column public.checkins.deducted is '這次入場是否有扣次（一天只扣一次）';
create index on public.checkins (branch_id, business_date);
create index on public.checkins (member_id, business_date);

-- =====================================================================
-- 8. 關帳
-- =====================================================================

create table public.daily_closings (
  id               uuid primary key default gen_random_uuid(),
  branch_id        uuid not null references public.branches(id),
  business_date    date not null,
  petty_cash       integer not null check (petty_cash >= 0),
  cash_sales       integer not null,
  line_pay_sales   integer not null,
  cash_refunds     integer not null,
  expected_cash    integer not null,
  counted_cash     integer not null check (counted_cash >= 0),
  difference       integer not null,
  difference_note  text,
  closed_by        uuid not null references public.staff(id),
  closed_at        timestamptz not null default now(),
  reopened_by      uuid references public.staff(id),
  reopened_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (branch_id, business_date),
  constraint diff_note_required check (difference = 0 or length(trim(coalesce(difference_note, ''))) > 0)
);
comment on table public.daily_closings is '每日關帳；reopened_at 有值代表已重新開帳';

-- 訂單流水號計數（每分館每天從 1 開始）
create table app.order_counters (
  branch_id      uuid not null references public.branches(id),
  business_date  date not null,
  last_no        integer not null default 0,
  primary key (branch_id, business_date)
);

-- =====================================================================
-- 9. 稽核
-- =====================================================================

create table public.audit_logs (
  id           bigint generated always as identity primary key,
  occurred_at  timestamptz not null default now(),
  staff_id     uuid references public.staff(id),
  branch_id    uuid references public.branches(id),
  action       text not null,
  table_name   text not null,
  record_id    uuid,
  before       jsonb,
  after        jsonb
);
comment on table public.audit_logs is '重要異動紀錄（只能新增）';
create index on public.audit_logs (table_name, record_id);
create index on public.audit_logs (branch_id, occurred_at desc);

-- =====================================================================
-- 共通觸發器：updated_at 與禁止刪除
-- =====================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'branches', 'staff', 'devices', 'members', 'waiver_versions', 'product_categories',
    'products', 'orders', 'member_plans', 'daily_closings'
  ] loop
    execute format(
      'create trigger touch_updated_at before update on public.%I
         for each row execute function app.touch_updated_at()', t);
  end loop;

  foreach t in array array[
    'branches', 'staff', 'devices', 'members', 'waiver_versions', 'waiver_signatures',
    'product_categories', 'products', 'orders', 'order_items', 'payments', 'refunds',
    'member_plans', 'checkins', 'daily_closings', 'audit_logs'
  ] loop
    execute format(
      'create trigger forbid_delete before delete on public.%I
         for each row execute function app.forbid_delete()', t);
  end loop;
end $$;
