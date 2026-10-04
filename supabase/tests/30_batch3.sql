-- 第 24 部分測試（接在 10_scenarios.sql 之後執行）：庫存管理角色、庫存新增商品／調入、品項排序、
-- 轉讓費與升級全店通（櫃檯收費、後台選訂單）、暫停指定期間。標「應被擋」的出現 ERROR 才正確（共 7 個）。
\set ON_ERROR_STOP 0
\pset pager off
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c1','stock@oy.tw');
insert into staff (name,email,role,branch_id) values ('庫管','stock@oy.tw','inventory',null);
select set_config('app.system_write','on',false);
update member_plans set status = 'active', start_date = current_date - 20, end_date = current_date + 29 where name = '月票';
select set_config('app.system_write','off',false);

\echo '===== 庫存管理'
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
select create_stock_product('10000000-0000-0000-0000-000000000002', '台中能量棒', 60, '20000000-0000-0000-0000-000000000001') is not null as created;
select stock_receive('10000000-0000-0000-0000-000000000002', jsonb_build_array(jsonb_build_object('product_id',(select id from products where name='台中能量棒'),'quantity',10)), '首批');
select jsonb_array_length(stock_overview(null)->'branches') as branches_seen;
select count(*) as members_seen from members;
select count(*) as orders_seen from orders;
\echo '--- 庫存管理結帳（應被擋）'
select checkout('{"items":[{"product_id":"30000000-0000-0000-0000-000000000004"}],"payments":[{"method":"cash","amount":100}]}');
reset role;

\echo '===== 店長：從台中調入萬華（可以）'
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
select stock_transfer('10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object('product_id',(select id from products where name='台中能量棒'),'quantity',3)), '調入');
\echo '--- 店長在台中新增商品（應被擋）'
select create_stock_product('10000000-0000-0000-0000-000000000002', 'x', 1, '20000000-0000-0000-0000-000000000001');
\echo '--- 店長排序品項（應被擋）'
select set_product_order(array['30000000-0000-0000-0000-000000000002'::uuid]);
reset role;
select b.code, app.stock_on_hand(b.id, p.id) from branches b, products p where p.name='台中能量棒' order by 1;
\echo '--- 櫃檯新增商品（應被擋）'
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a3';
select create_stock_product('10000000-0000-0000-0000-000000000001', 'y', 1, '20000000-0000-0000-0000-000000000001');
reset role;

\echo '===== 總部排序、設定轉讓費與升級差價'
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select set_product_order(array['30000000-0000-0000-0000-000000000004','30000000-0000-0000-0000-000000000001']::uuid[]);
select name, sort_order from products where id in ('30000000-0000-0000-0000-000000000004','30000000-0000-0000-0000-000000000001') order by sort_order;
update products set price = 300 where fee_kind = 'transfer_fee';
update products set price = 500, status = 'on_sale' where fee_kind = 'upgrade_fee';
reset role;

\echo '===== 櫃檯收費'
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a3';
\echo '--- 沒指定會員賣轉讓費（應被擋）'
select checkout(jsonb_build_object('items', jsonb_build_array(jsonb_build_object('product_id',(select id from products where fee_kind='transfer_fee'))),
  'payments', jsonb_build_array(jsonb_build_object('method','cash','amount',300))));
select checkout(jsonb_build_object('member_id','40000000-0000-0000-0000-000000000002','items', jsonb_build_array(jsonb_build_object('product_id',(select id from products where fee_kind='transfer_fee'))),
  'payments', jsonb_build_array(jsonb_build_object('method','cash','amount',300)))) ->> 'order_no' as fee_order;
select checkout(jsonb_build_object('member_id','40000000-0000-0000-0000-000000000001','items', jsonb_build_array(jsonb_build_object('product_id',(select id from products where fee_kind='upgrade_fee'))),
  'payments', jsonb_build_array(jsonb_build_object('method','cash','amount',500)))) ->> 'order_no' as upgrade_order;
reset role;

\echo '===== 總部轉讓（用轉入會員付的轉讓費）'
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select jsonb_array_length(member_fee_orders(array['40000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002']::uuid[], 'transfer_fee')) as fee_orders;
\echo '--- 沒選訂單也沒填免收原因（應被擋）'
select transfer_plan((select id from member_plans where name='十次券'), '40000000-0000-0000-0000-000000000002', '送朋友');
select transfer_plan((select id from member_plans where name='十次券'), '40000000-0000-0000-0000-000000000002', '送朋友',
  (member_fee_orders(array['40000000-0000-0000-0000-000000000002']::uuid[], 'transfer_fee') -> 0 ->> 'id')::uuid);
select jsonb_array_length(member_fee_orders(array['40000000-0000-0000-0000-000000000002']::uuid[], 'transfer_fee')) as fee_orders_left;
select transfer_plan((select id from member_plans where name='十次券'), '40000000-0000-0000-0000-000000000001', '轉回', null, '老闆同意免收');
select (select m.name from members m where m.id = p.member_id) from member_plans p where name='十次券';
\echo '--- 升級全店通'
reset role;
select set_config('app.system_write','on',false);
update member_plans set branch_ids = array['10000000-0000-0000-0000-000000000001'::uuid] where name = '月票';
select set_config('app.system_write','off',false);
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select upgrade_plan_all_branches((select id from member_plans where name='月票'),
  (member_fee_orders(array['40000000-0000-0000-0000-000000000001']::uuid[], 'upgrade_fee') -> 0 ->> 'id')::uuid);
select name, branch_ids is null as all_shop, end_date from member_plans where name='月票';

\echo '===== 暫停指定期間'
-- 補登過去：10 天前到 4 天前（7 天）→ 到期日 +7，仍可使用
select freeze_plan((select id from member_plans where name='月票'), '出國', current_date - 10, current_date - 4);
select status, frozen_at, end_date - current_date as days_left from member_plans where name='月票';
-- 從今天開始、結束日未定 → 暫停中
select freeze_plan((select id from member_plans where name='月票'), '受傷', current_date, null);
reset role; select status, frozen_at, frozen_until, app.plan_block_reason(p, '10000000-0000-0000-0000-000000000001') from member_plans p where name='月票';
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
\echo '--- 暫停中再暫停（應被擋）'
select freeze_plan((select id from member_plans where name='月票'), 'x', current_date, null);
-- 設定結束日為 5 天後（共 6 天）→ 仍暫停中，到期日 +6
select unfreeze_plan((select id from member_plans where name='月票'), current_date + 5);
select status, frozen_until, end_date - current_date as days_left from member_plans where name='月票';
-- 今天恢復（結束日＝昨天，暫停 0 天）→ 到期日回到 -6
select unfreeze_plan((select id from member_plans where name='月票'));
select status, frozen_at, end_date - current_date as days_left from member_plans where name='月票';
-- 預定下週暫停 3 天：現在仍可使用
select freeze_plan((select id from member_plans where name='月票'), '旅行', current_date + 7, current_date + 9);
reset role; select status, frozen_at, end_date - current_date as days_left, app.plan_block_reason(p, '10000000-0000-0000-0000-000000000001') as block from member_plans p where name='月票';
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
-- 取消預定的暫停 → 到期日回復
select unfreeze_plan((select id from member_plans where name='月票'), current_date - 1);
select status, frozen_at, end_date - current_date as days_left from member_plans where name='月票';
reset role;
select action, after from audit_logs where action like 'member_plan.%' and occurred_at > now() - interval '1 minute' order by occurred_at;
