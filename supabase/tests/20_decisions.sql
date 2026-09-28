-- 2026-09-29 決策調整的情境測試（在 npx supabase start 的本機環境執行，需先跑 resetdb 建立測試帳號）
-- 標示「應被擋」的步驟出現 ERROR 才是正確結果
\pset pager off
select (select id::text from auth.users where email='cashier@test.tw') as cashier_id,
       (select id::text from auth.users where email='manager@test.tw') as manager_id,
       (select id::text from auth.users where email='kiosk@test.tw') as kiosk_id,
       (select id::text from auth.users where phone='886912345678') as member_uid \gset
insert into devices (email, branch_id, name) select 'kiosk@test.tw', id, '萬華入場機' from branches where code='WH';
update branches set petty_cash_default = 3000 where code='WH';
select code, brand_label, petty_cash_default, kiosk_volume from branches where code in ('WH','ZH');

set role authenticated;
select set_config('request.jwt.claim.sub', :'cashier_id', false) \g /dev/null
\echo '--- 同意書沒勾三項（應被擋）'
insert into waiver_signatures (member_id, waiver_version_id, method, signature_path)
 select m.id, w.id, 'counter', 'a.png' from members m, waiver_versions w where m.name='王小明';
insert into waiver_signatures (member_id, waiver_version_id, method, signature_path, agree_risk, agree_health, agree_privacy)
 select m.id, w.id, 'counter', 'a.png', true, true, true from members m, waiver_versions w where m.name='王小明';
\echo '--- 未成年沒有法定代理人簽名（應被擋）'
insert into waiver_signatures (member_id, waiver_version_id, method, signature_path, agree_risk, agree_health, agree_privacy, guardian_name, guardian_phone, guardian_relation)
 select m.id, w.id, 'counter', 'b.png', true, true, true, '林爸爸', '0911', '父' from members m, waiver_versions w where m.name='林小美';
insert into waiver_signatures (member_id, waiver_version_id, method, signature_path, agree_risk, agree_health, agree_privacy, guardian_name, guardian_phone, guardian_relation, guardian_signature_path)
 select m.id, w.id, 'counter', 'b.png', true, true, true, '林爸爸', '0911', '父', 'g.png' from members m, waiver_versions w where m.name='林小美';
select m.name, s.is_minor, s.guardian_signature_path is not null as guardian_signed from waiver_signatures s join members m on m.id=s.member_id;

\echo '--- 結帳：十次券 + 月票 給王小明'
select checkout(jsonb_build_object('member_id',(select id from members where name='王小明'),
  'items',jsonb_build_array(jsonb_build_object('product_id',(select id from products where name='十次券')),jsonb_build_object('product_id',(select id from products where name='月票'))),
  'payments',jsonb_build_array(jsonb_build_object('method','cash','amount',6400,'cash_received',7000))))->>'order_no' as order_no;

\echo '--- 櫃檯退款（應被擋：限店長以上）'
select refund_order((select id from orders limit 1), 'cash', 100, '測試');

\echo '--- 櫃檯用掃碼器找會員'
reset role;
select 'OY1.M000001.' || app.totp(k.secret, app.current_step()) || '.' || (select id from member_plans where name='十次券') as qr
  from app.member_qr_keys k join members m on m.id=k.member_id where m.name='王小明' \gset
set role authenticated;
select set_config('request.jwt.claim.sub', :'cashier_id', false) \g /dev/null
select resolve_member_qr(:'qr') ->> 'ok' as ok, resolve_member_qr('OY1.M000001.00000000') ->> 'message' as bad_qr;

\echo '--- 入場機掃「十次券」的 QR：應扣十次券（不是月票）'
select set_config('request.jwt.claim.sub', :'kiosk_id', false) \g /dev/null
select r->>'screen' as screen, r->'plan'->>'name' as plan, r->'plan'->>'remaining_count' as remaining, r->'branch'->>'kiosk_volume' as vol
  from (select kiosk_checkin(:'qr') r) x;

\echo '--- 入場機：月票過期的會員 → expired 畫面並帶出方案'
reset role;
insert into waiver_signatures (member_id, waiver_version_id, method, signature_path, agree_risk, agree_health, agree_privacy)
 select m.id, w.id, 'paper', 'c.png', true, true, true from members m, waiver_versions w where m.name='陳大文';
insert into member_plans (member_id, product_id, name, content_type, start_date, end_date, status)
 select m.id, p.id, '月票', 'days', app.today()-40, app.today()-10, 'active' from members m, products p where m.name='陳大文' and p.name='月票';
select 'OY1.M000003.' || app.totp(k.secret, app.current_step()) as qr2 from app.member_qr_keys k join members m on m.id=k.member_id where m.name='陳大文' \gset
set role authenticated;
select set_config('request.jwt.claim.sub', :'kiosk_id', false) \g /dev/null
select r->>'screen' as screen, r->>'result' as result, r->'blocked_plan'->>'name' as blocked, r->'blocked_plan'->>'end_date' as ended
  from (select kiosk_checkin(:'qr2') r) x;

\echo '--- 方案異動：櫃檯暫停（應被擋）'
select set_config('request.jwt.claim.sub', :'cashier_id', false) \g /dev/null
select freeze_plan((select id from member_plans where name='月票' and member_id=(select id from members where name='王小明')), '受傷');
\echo '--- 店長：暫停、恢復、延期、轉讓'
select set_config('request.jwt.claim.sub', :'manager_id', false) \g /dev/null
select freeze_plan((select id from member_plans where name='月票' and member_id=(select id from members where name='王小明')), '受傷');
select status, frozen_at is not null as has_frozen_at from member_plans where name='月票' and member_id=(select id from members where name='王小明');
select unfreeze_plan((select id from member_plans where name='月票' and member_id=(select id from members where name='王小明')));
select extend_plan((select id from member_plans where name='月票' and member_id=(select id from members where name='王小明')), 7, '颱風停館');
select name, status, end_date - start_date + 1 as days from member_plans where name='月票' and member_id=(select id from members where name='王小明');
select transfer_plan((select id from member_plans where name='月票' and member_id=(select id from members where name='王小明')), (select id from members where name='陳大文'), '朋友轉讓');
select m.name as owner, p.name from member_plans p join members m on m.id=p.member_id where p.name='月票' and p.end_date > app.today();

\echo '--- 店長退款（可以）'
select refund_order((select id from orders limit 1), 'cash', 3800, '客人搬家') is not null as refunded;

\echo '--- 店長品項：改全店通用品項價格（改不到，0 筆）；新增自己分館品項並改價（可以）'
update products set price = 1 where name='十次券';
insert into products (name, category_id, price, content_type, quantity, all_branches)
 select '萬華限定活動票', id, 500, 'single', 1, false from product_categories where name='成人票';
insert into product_branches select id, (select id from branches where code='WH') from products where name='萬華限定活動票';
update products set price = 450 where name='萬華限定活動票' returning name, price;
\echo '--- 店長把自己的品項掛到別的分館（應被擋）'
insert into product_branches select id, (select id from branches where code='ZH') from products where name='萬華限定活動票';

\echo '--- 關帳預覽：品項銷售、固定零用金；零用金不填時自動用 3000'
select set_config('request.jwt.claim.sub', :'cashier_id', false) \g /dev/null
select (p->>'petty_cash_default') as petty, p->'item_sales' as item_sales, p->>'cash_count' as cash_count from (select closing_preview() p) x;
select (close_day(null, 3000 + 6400 - 3800))->>'petty_cash' as petty_used;

\echo '--- 會員自行註冊（應被擋）'
select set_config('request.jwt.claim.sub', :'member_uid', false) \g /dev/null
select register_me('路人', '2000-01-01', (select id from branches where code='WH'), 'a', '0911', 'b');
reset role;
select action from audit_logs order by id;
