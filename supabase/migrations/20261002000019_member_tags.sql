-- =====================================================================
-- 原岩攀岩館 會員與櫃檯系統
-- 第 19 部分：顧客標籤與行為紀錄（老闆 2026-10-02 決定）
--   member_tags       標籤（名稱＋顏色）：總部新增、修改、停用（不能刪除）
--   member_tag_links  會員貼了哪些標籤：總部、店長可以貼上／拿掉（寫入異動紀錄）
--   member_notes      行為紀錄（例：借用裝備未歸還、協助新手、違反安全規則）：
--                     所有員工（含櫃檯）都可以新增；不能修改刪除，店長以上可「隱藏」並寫原因
--   會員本人看不到標籤與行為紀錄；會計帳號也看不到（app.is_staff() 不含會計）
--   注意：依規定不記錄任何健康資料或病史（畫面上會提醒）
-- =====================================================================

create table public.member_tags (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (length(trim(name)) between 1 and 20),
  bg_color    text not null check (bg_color ~ '^#[0-9A-F]{6}$'),
  text_color  text not null check (text_color ~ '^#[0-9A-F]{6}$'),
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.member_tags is '顧客標籤（總部管理；不能刪除，只能停用）';

create table public.member_tag_links (
  member_id  uuid not null references public.members(id),
  tag_id     uuid not null references public.member_tags(id),
  added_by   uuid references public.staff(id),
  added_at   timestamptz not null default now(),
  primary key (member_id, tag_id)
);
create index on public.member_tag_links (tag_id);
comment on table public.member_tag_links is '會員貼了哪些標籤（透過 set_member_tags 修改）';

create table public.member_notes (
  id             uuid primary key default gen_random_uuid(),
  member_id      uuid not null references public.members(id),
  branch_id      uuid references public.branches(id),
  staff_id       uuid not null references public.staff(id),
  body           text not null check (length(trim(body)) between 1 and 500),
  created_at     timestamptz not null default now(),
  hidden_at      timestamptz,
  hidden_by      uuid references public.staff(id),
  hidden_reason  text
);
create index on public.member_notes (member_id, created_at desc);
comment on table public.member_notes is '顧客行為紀錄（員工可新增；不能修改刪除，店長以上可隱藏）；會員看不到';

create trigger forbid_delete before delete on public.member_tags for each row execute function app.forbid_delete();
create trigger forbid_delete before delete on public.member_notes for each row execute function app.forbid_delete();
create trigger touch_updated_at before update on public.member_tags for each row execute function app.touch_updated_at();

-- 標籤：員工都能讀；總部新增修改（直接寫表，RLS 把關）
alter table public.member_tags enable row level security;
grant select, insert, update on public.member_tags to authenticated;
create policy member_tags_read on public.member_tags for select to authenticated using (app.is_staff());
create policy member_tags_hq_insert on public.member_tags for insert to authenticated with check (app.is_hq());
create policy member_tags_hq_update on public.member_tags for update to authenticated using (app.is_hq());

-- 貼標籤與行為紀錄：員工都能讀；只能透過下面的函式寫入
alter table public.member_tag_links enable row level security;
revoke all on public.member_tag_links from public, anon, authenticated;
grant select on public.member_tag_links to authenticated;
create policy member_tag_links_read on public.member_tag_links for select to authenticated using (app.is_staff());

alter table public.member_notes enable row level security;
revoke all on public.member_notes from public, anon, authenticated;
grant select on public.member_notes to authenticated;
create policy member_notes_read on public.member_notes for select to authenticated using (app.is_staff());

-- 標籤修改寫入異動紀錄
create or replace function app.audit_member_tag() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.audit(case when tg_op = 'INSERT' then 'member_tag.created' else 'member_tag.updated' end,
                    'member_tags', new.id, null, case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new));
  return new;
end $$;
create trigger audit_change after insert or update on public.member_tags
  for each row execute function app.audit_member_tag();

-- ---------------------------------------------------------------------
-- 設定會員的標籤（傳入完整清單，差異寫入異動紀錄）：總部、店長
-- ---------------------------------------------------------------------
create or replace function public.set_member_tags(p_member_id uuid, p_tag_ids uuid[])
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.staff; v_before text[]; v_after text[]; v_ids uuid[] := coalesce(p_tag_ids, '{}');
begin
  s := app.require_staff(array['hq', 'manager']::public.staff_role[]);
  if not exists (select 1 from public.members where id = p_member_id) then
    raise exception '找不到會員' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_ids) t(id) where not exists (select 1 from public.member_tags where id = t.id)) then
    raise exception '標籤不存在' using errcode = '22023';
  end if;

  select coalesce(array_agg(t.name order by t.sort_order, t.name), '{}') into v_before
  from public.member_tag_links l join public.member_tags t on t.id = l.tag_id where l.member_id = p_member_id;

  delete from public.member_tag_links where member_id = p_member_id and tag_id <> all (v_ids);
  insert into public.member_tag_links (member_id, tag_id, added_by)
  select p_member_id, t.id, s.id from (select distinct unnest(v_ids) as id) t
  on conflict do nothing;

  select coalesce(array_agg(t.name order by t.sort_order, t.name), '{}') into v_after
  from public.member_tag_links l join public.member_tags t on t.id = l.tag_id where l.member_id = p_member_id;

  if v_before is distinct from v_after then
    perform app.audit('member.tags_changed', 'members', p_member_id,
                      case when s.role = 'hq' then null else s.branch_id end,
                      jsonb_build_object('tags', v_before), jsonb_build_object('tags', v_after));
  end if;
  return jsonb_build_object('tags', v_after);
end $$;

-- ---------------------------------------------------------------------
-- 新增行為紀錄：所有員工（櫃檯傳入目前分館；總部可不填）
-- ---------------------------------------------------------------------
create or replace function public.add_member_note(p_member_id uuid, p_body text, p_branch_id uuid default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.staff; v_id uuid;
begin
  s := app.require_staff(array['hq', 'manager', 'cashier']::public.staff_role[]);
  if not exists (select 1 from public.members where id = p_member_id) then
    raise exception '找不到會員' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_body, ''))) = 0 then
    raise exception '請填寫內容' using errcode = '22023';
  end if;
  if length(trim(p_body)) > 500 then
    raise exception '內容最多 500 個字' using errcode = '22023';
  end if;
  insert into public.member_notes (member_id, branch_id, staff_id, body)
  values (p_member_id, case when s.role = 'hq' then p_branch_id else s.branch_id end, s.id, trim(p_body))
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 隱藏行為紀錄（寫錯、不適當）：店長以上，必填原因，寫入異動紀錄
-- ---------------------------------------------------------------------
create or replace function public.hide_member_note(p_note_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.staff; n public.member_notes;
begin
  s := app.require_staff(array['hq', 'manager']::public.staff_role[]);
  select * into n from public.member_notes where id = p_note_id;
  if n.id is null then raise exception '找不到這筆紀錄' using errcode = '22023'; end if;
  if n.hidden_at is not null then raise exception '這筆紀錄已經隱藏了' using errcode = '22023'; end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception '請填寫隱藏原因' using errcode = '22023';
  end if;
  update public.member_notes set hidden_at = now(), hidden_by = s.id, hidden_reason = trim(p_reason) where id = n.id;
  perform app.audit('member.note_hidden', 'members', n.member_id,
                    case when s.role = 'hq' then n.branch_id else s.branch_id end,
                    jsonb_build_object('note', n.body), jsonb_build_object('reason', trim(p_reason)));
end $$;

revoke all on function public.set_member_tags(uuid, uuid[]) from public, anon;
revoke all on function public.add_member_note(uuid, text, uuid) from public, anon;
revoke all on function public.hide_member_note(uuid, text) from public, anon;
grant execute on function public.set_member_tags(uuid, uuid[]) to authenticated;
grant execute on function public.add_member_note(uuid, text, uuid) to authenticated;
grant execute on function public.hide_member_note(uuid, text) to authenticated;
