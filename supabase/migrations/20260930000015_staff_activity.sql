-- =====================================================================
-- 原岩攀岩館 會員與櫃檯系統
-- 第 15 部分：員工使用足跡（老闆 2026-09-30 決定）
--   所有員工帳號（總部、店長、櫃檯）都記錄：登入／登出、開啟系統、打開哪些頁面、查看哪位會員、匯出 Excel
--   修改內容仍記在 audit_logs（異動紀錄）；這裡只記「看了什麼、做了什麼操作」
--   紀錄只能新增，不能修改或刪除
-- =====================================================================

create table public.staff_activity (
  id           bigint generated always as identity primary key,
  occurred_at  timestamptz not null default now(),
  staff_id     uuid not null references public.staff(id),
  branch_id    uuid references public.branches(id),
  app          text not null check (app in ('counter', 'admin')),
  action       text not null check (action in ('login', 'logout', 'open', 'page_view', 'member_view', 'export')),
  target       text,
  member_id    uuid references public.members(id),
  ip           text,
  user_agent   text
);
comment on table public.staff_activity is '員工使用足跡（登入、瀏覽頁面、查看會員、匯出）；只能新增';
comment on column public.staff_activity.branch_id is '操作時所在分館（櫃檯選的分館；總部為空）';
create index on public.staff_activity (occurred_at desc);
create index on public.staff_activity (staff_id, occurred_at desc);
create index on public.staff_activity (member_id) where member_id is not null;

create trigger forbid_delete before delete on public.staff_activity
  for each row execute function app.forbid_delete();
create or replace function app.forbid_update_activity() returns trigger
language plpgsql as $$
begin
  raise exception '使用足跡不能修改' using errcode = '42501';
end $$;
create trigger forbid_update before update on public.staff_activity
  for each row execute function app.forbid_update_activity();

-- 只能透過下面的函式寫入與讀取
alter table public.staff_activity enable row level security;
revoke all on public.staff_activity from public, anon, authenticated;

-- 記錄一筆足跡（畫面呼叫）；IP 與瀏覽器由伺服器從連線資訊取得，不相信畫面傳入
create or replace function public.log_activity(
  p_app text, p_action text, p_target text default null, p_member_id uuid default null, p_branch_id uuid default null
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.staff;
  h json := nullif(current_setting('request.headers', true), '')::json;
begin
  select * into s from public.staff where auth_user_id = auth.uid() and status = 'active';
  if s.id is null then return; end if;   -- 不是員工（例如入場機、會員）就不記
  insert into public.staff_activity (staff_id, branch_id, app, action, target, member_id, ip, user_agent)
  values (s.id,
          case when s.role = 'hq' then p_branch_id else s.branch_id end,
          p_app, p_action, left(p_target, 300), p_member_id,
          left(trim(split_part(coalesce(h ->> 'x-forwarded-for', h ->> 'x-real-ip', ''), ',', 1)), 64),
          left(h ->> 'user-agent', 300));
end $$;

-- 查詢足跡：總部看全部；店長看自己分館的員工（含自己），看不到總部帳號
create or replace function public.activity_feed(
  p_from date, p_to date, p_branch_id uuid default null, p_staff_id uuid default null,
  p_action text default null, p_member_id uuid default null, p_limit integer default 500
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.staff;
begin
  s := app.require_staff(array['hq', 'manager']::public.staff_role[]);
  perform app.report_check_range(p_from, p_to);
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'at', a.occurred_at, 'app', a.app, 'action', a.action, 'target', a.target,
        'staff', st.name, 'role', st.role, 'branch', br.name,
        'member', case when m.id is not null then jsonb_build_object('id', m.id, 'name', m.name, 'no', m.member_no) end,
        'ip', a.ip, 'user_agent', a.user_agent) order by a.occurred_at desc), '[]'::jsonb)
    from (
      select a.* from public.staff_activity a
      join public.staff st2 on st2.id = a.staff_id
      where a.occurred_at >= (p_from::timestamp at time zone 'Asia/Taipei')
        and a.occurred_at < ((p_to + 1)::timestamp at time zone 'Asia/Taipei')
        and (p_staff_id is null or a.staff_id = p_staff_id)
        and (p_member_id is null or a.member_id = p_member_id)
        and (p_action is null or a.action = p_action or (p_action = 'login' and a.action in ('login', 'logout', 'open')))
        and (p_branch_id is null or a.branch_id = p_branch_id or st2.branch_id = p_branch_id)
        and (s.role = 'hq' or (st2.role <> 'hq' and (st2.branch_id = s.branch_id or a.staff_id = s.id)))
      order by a.occurred_at desc
      limit least(greatest(coalesce(p_limit, 500), 1), 3000)
    ) a
    join public.staff st on st.id = a.staff_id
    left join public.branches br on br.id = coalesce(a.branch_id, st.branch_id)
    left join public.members m on m.id = a.member_id
  );
end $$;

revoke all on function public.log_activity(text, text, text, uuid, uuid) from public, anon;
revoke all on function public.activity_feed(date, date, uuid, uuid, text, uuid, integer) from public, anon;
grant execute on function public.log_activity(text, text, text, uuid, uuid) to authenticated;
grant execute on function public.activity_feed(date, date, uuid, uuid, text, uuid, integer) to authenticated;
