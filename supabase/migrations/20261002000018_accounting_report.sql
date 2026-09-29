-- =====================================================================
-- 原岩攀岩館 會員與櫃檯系統
-- 第 18 部分：會計報表（老闆 2026-10-02 決定：每個月給會計消費總額、消費紀錄與發票號碼）
--   report_accounting：
--     summary      銷售（依營業日，不含作廢）、退款（依退款日）、淨額、營業稅 5%（價格含稅，反推）
--     by_day       每日 × 分館：銷售、現金、LINE Pay、退款、淨額、發票張數
--     invoices     每筆訂單（含作廢）：發票號碼、載具／統編、品項、金額、付款方式、狀態
--     refunds      每筆退款：退款日、原訂單與發票號碼、金額、方式、原因
--   明細（invoices、refunds）最多 62 天，避免一次拿太多資料；每月匯出一次即可
-- =====================================================================

create or replace function public.report_accounting(p_from date, p_to date, p_branch_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_b uuid[];
begin
  v_b := app.report_branches(p_branch_id);
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
           coalesce(sum(p.amount) filter (where p.method = 'line_pay'), 0)::int as line_pay
    from public.payments p where p.order_id in (select id from o) group by p.order_id),
  sold as (select o.*, coalesce(pay.cash, 0) as cash, coalesce(pay.line_pay, 0) as line_pay
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
        'refunds', t.refunds,
        'refund_cash', (select coalesce(sum(amount), 0) from rf where method = 'cash'),
        'refund_line_pay', (select coalesce(sum(amount), 0) from rf where method = 'line_pay'),
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
               coalesce(s.orders, 0) as orders, coalesce(r.refunds, 0) as refunds,
               coalesce(s.sales, 0) - coalesce(r.refunds, 0) as net
        from (select business_date as date, branch_name as branch from sold
              union select business_date, branch_name from rf) d
        left join (select business_date, branch_name, sum(total)::int as sales, sum(cash)::int as cash,
                          sum(line_pay)::int as line_pay, count(*)::int as orders
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
               coalesce(pay.cash, 0) as cash, coalesce(pay.line_pay, 0) as line_pay,
               o.status, o.void_reason
        from o left join pay on pay.order_id = o.id) x),
    'refunds', (select coalesce(jsonb_agg(x order by x.at), '[]'::jsonb) from (
        select rf.business_date as date, rf.refunded_at as at, rf.branch_name as branch, rf.order_no,
               rf.invoice_no, rf.order_date, rf.amount, rf.method, rf.reason
        from rf) x)
  ));
end $$;

revoke all on function public.report_accounting(date, date, uuid) from public, anon;
grant execute on function public.report_accounting(date, date, uuid) to authenticated;
