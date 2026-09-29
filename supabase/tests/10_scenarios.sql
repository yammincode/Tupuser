-- 情境測試：以不同身分操作，確認規則與權限。註解寫「應被擋」的指令出現 ERROR 才是正確。
-- 執行方式見 supabase/tests/README.md
\set ON_ERROR_STOP 0
\pset pager off
-- ===== 設定資料（系統管理身分）
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-0000000000a1','boss@oy.tw'),
 ('00000000-0000-0000-0000-0000000000a2','mgr@oy.tw'),
 ('00000000-0000-0000-0000-0000000000a3','cash@oy.tw'),
 ('00000000-0000-0000-0000-0000000000a4','cash2@oy.tw'),
 ('00000000-0000-0000-0000-0000000000d1','kiosk1@oy.tw');
insert into branches (id, code, name) values
 ('10000000-0000-0000-0000-000000000001','TPE','萬華館'),('10000000-0000-0000-0000-000000000002','TCH','台中館');
insert into staff (name,email,role,branch_id) values
 ('老闆','BOSS@oy.tw','hq',null),('店長','mgr@oy.tw','manager','10000000-0000-0000-0000-000000000001'),
 ('櫃檯','cash@oy.tw','cashier','10000000-0000-0000-0000-000000000001'),('台中櫃檯','cash2@oy.tw','cashier','10000000-0000-0000-0000-000000000002');
insert into devices (email, branch_id, name) values ('kiosk1@oy.tw','10000000-0000-0000-0000-000000000001','萬華入場機1');
select name, role, auth_user_id is not null as linked from staff;
insert into product_categories (id,name) values ('20000000-0000-0000-0000-000000000001','入場');
insert into products (id,name,category_id,price,content_type,quantity,usage_rule) values
 ('30000000-0000-0000-0000-000000000001','單次入場','20000000-0000-0000-0000-000000000001',400,'single',1,'any'),
 ('30000000-0000-0000-0000-000000000002','十次券','20000000-0000-0000-0000-000000000001',3500,'punch',10,'any'),
 ('30000000-0000-0000-0000-000000000003','月票','20000000-0000-0000-0000-000000000001',2000,'days',30,'any'),
 ('30000000-0000-0000-0000-000000000004','岩鞋租借','20000000-0000-0000-0000-000000000001',100,'rental',1,'any');
insert into waiver_versions (version,title,content,effective_date) values ('2026.1','同意書','全文...', current_date - 1);

-- ===== 櫃檯新增會員
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a3';
insert into members (id, phone,name,birthday,emergency_name,emergency_phone,emergency_relation,home_branch_id,staff_note)
 values ('40000000-0000-0000-0000-000000000001','0912-345-678','王小明','1995-05-05','王媽媽','0922000000','母','10000000-0000-0000-0000-000000000001','常客');
select member_no, phone, created_by_staff_id is not null as has_creator from members;
\echo '--- 櫃檯改品項價格（應該改不到，0 筆）'
update products set price = 1 where id='30000000-0000-0000-0000-000000000001';
\echo '--- 櫃檯改會員資料（應該改不到，0 筆）'
update members set name='x';
\echo '--- 櫃檯刪除品項（應該被擋）'
delete from products;
reset role;
\echo '--- 店長改手機（應該被擋）'
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
update members set phone='0911111111';
update members set emergency_name='王爸爸';
reset role;
\echo '--- 總部改手機（可以）'
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
update members set phone='0911111111' returning phone;
update members set phone='0912345678' returning phone;
reset role;
-- 會員用簡訊登入（自動連結）
insert into auth.users (id, phone) values ('00000000-0000-0000-0000-0000000000b1','886912345678');
select name, auth_user_id from members;

-- ===== 結帳
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a3';
\echo '--- 付款金額不對（整筆失敗）'
select checkout('{"member_id":"40000000-0000-0000-0000-000000000001","items":[{"product_id":"30000000-0000-0000-0000-000000000002"}],"payments":[{"method":"cash","amount":100}]}');
select count(*) as orders_after_fail from orders;
\echo '--- 正常結帳：十次券 + 月票 + 租借，現金+LINE Pay'
select checkout('{"member_id":"40000000-0000-0000-0000-000000000001","items":[{"product_id":"30000000-0000-0000-0000-000000000002"},{"product_id":"30000000-0000-0000-0000-000000000004","quantity":1}],"discount_amount":100,"discount_reason":"學生","payments":[{"method":"cash","amount":2000,"cash_received":2500},{"method":"line_pay","amount":1500,"line_pay_transaction_id":"LP1"}]}');
select name, content_type, remaining_count, start_date, end_date, status from member_plans;
select product_name, unit_price, quantity, line_total from order_items;

-- ===== 入場
reset role;
\echo '--- 未簽同意書（櫃檯入場）'
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a3';
select counter_checkin('40000000-0000-0000-0000-000000000001')->>'result';
insert into waiver_signatures (member_id, waiver_version_id, method, signature_path, agree_risk, agree_health, agree_privacy)
 select '40000000-0000-0000-0000-000000000001', id, 'counter', 'x.png', true, true, true from waiver_versions;
select is_minor, staff_id is not null, branch_id is not null from waiver_signatures;
reset role;
\echo '--- 入場機掃 QR（正確碼）'
select 'OY1.M000001.' || app.totp(secret, app.current_step()) as qr from app.member_qr_keys \gset
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
select kiosk_checkin(:'qr') - 'member' as r1;
\echo '--- 同一碼再掃（剛入場，回覆成功不扣）'
select kiosk_checkin(:'qr')->>'result' as r2, kiosk_checkin(:'qr')->>'repeated' as rep;
\echo '--- 亂碼'
select kiosk_checkin('OY1.M000001.12345678')->>'result';
\echo '--- 入場機想讀會員資料（0 筆）'
select count(*) from members;
reset role;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a3';
\echo '--- 同一天櫃檯再入場（不再扣）'
select counter_checkin('40000000-0000-0000-0000-000000000001') ->'plan';
select result, deducted, method from checkins order by checked_in_at;

-- ===== 會員 App
reset role; set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
\echo '--- 會員看自己資料（不應有 staff_note）'
select get_my_profile() ? 'staff_note' as has_note, get_my_profile()->>'name', get_my_profile()->>'waiver_required';
select count(*) as members_visible from members;
select count(*) as plans_direct_read_should_be_0 from member_plans;
select jsonb_array_length(my_app_home()->'plans') as my_plans, my_app_home()->'member'->>'name' as app_name;
select jsonb_array_length(my_checkins()) as my_checkins;
select update_my_profile('{"phone":"0900000000"}');
select get_my_qr_secret() ? 'secret_hex';

-- ===== 退款與關帳
select id as oid from orders limit 1 \gset
reset role; set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a4';
\echo '--- 台中櫃檯退萬華的單（應被擋）'
select refund_order(:'oid', 'cash', 100, '測試');
reset role; set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a3';
\echo '--- 櫃檯開一張單再退款'
select checkout('{"member_id":"40000000-0000-0000-0000-000000000001","items":[{"product_id":"30000000-0000-0000-0000-000000000003"}],"payments":[{"method":"cash","amount":2000}]}')->>'order_no' as no2;
\echo '--- 櫃檯退款（應被擋：限店長以上）'
select refund_order((select id from orders where total=2000 and status='paid' and subtotal=2000), 'cash', 2000, '客人不要了') is not null as refunded;
reset role; set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
select refund_order((select id from orders where total=2000 and status='paid' and subtotal=2000), 'cash', 2000, '客人不要了') is not null as refunded;
reset role; set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a3';
select name, status, end_date - start_date + 1 as days from member_plans where content_type='days';
select closing_preview();
\echo '--- 關帳：差額不為 0 沒寫說明（應被擋）'
select close_day(5000, 4990);
select close_day(5000, 7000) ->> 'expected_cash';
\echo '--- 關帳後櫃檯結帳（應被擋）'
select checkout('{"items":[{"product_id":"30000000-0000-0000-0000-000000000004"}],"payments":[{"method":"cash","amount":100}]}');
\echo '--- 關帳後櫃檯作廢（應被擋）'
select void_order((select id from orders where status='paid' limit 1), '打錯');
reset role; set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
\echo '--- 店長改關帳後訂單備註（可以，留紀錄）'
update orders set note='店長補註' where status='paid' returning order_no;
select reopen_day(app.today(), '補登一筆');
reset role;
select action, table_name from audit_logs order by id;
\echo '--- 刪除訂單（應被擋）'
delete from orders;

\echo '--- 改價：舊訂單明細不變'
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
update products set price = 3800 where name='十次券';
reset role;
select product_name, unit_price from order_items where product_name='十次券';
select action from audit_logs order by id desc limit 3;
\echo '--- 會員讀品項（只看上架的）; 會員讀別人的訂單（0）'
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
select count(*) as products_visible from products;
select count(*) as my_orders from orders;
reset role;
\echo '--- 平日票在假日、分館限制'
update products set price=300 where name='單次入場';
insert into products (name,category_id,price,content_type,quantity,all_branches) values ('台中限定十次','20000000-0000-0000-0000-000000000001',3000,'punch',10,false);
insert into product_branches select id,'10000000-0000-0000-0000-000000000002' from products where name='台中限定十次';
insert into members (id, phone,name,birthday,emergency_name,emergency_phone,emergency_relation,home_branch_id) values ('40000000-0000-0000-0000-000000000002','0933000000','小美','2012-01-01','美媽','0922','母','10000000-0000-0000-0000-000000000002');
insert into member_plans (member_id, product_id, name, content_type, total_count, remaining_count, start_date, branch_ids)
 select '40000000-0000-0000-0000-000000000002', id, name, 'punch', 10, 10, current_date, array['10000000-0000-0000-0000-000000000002'::uuid] from products where name='台中限定十次';
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
\echo '--- 未成年沒填法定代理人（應被擋）'
insert into waiver_signatures (member_id, waiver_version_id, method, signature_path, agree_risk, agree_health, agree_privacy) select '40000000-0000-0000-0000-000000000002', id, 'counter', 'y.png', true, true, true from waiver_versions;
insert into waiver_signatures (member_id, waiver_version_id, method, signature_path, guardian_name, guardian_phone, guardian_relation, guardian_signature_path, agree_risk, agree_health, agree_privacy) select '40000000-0000-0000-0000-000000000002', id, 'counter', 'y.png','美媽','0922','母','g.png', true, true, true from waiver_versions;
select counter_checkin('40000000-0000-0000-0000-000000000002')->>'result' as tpe_result;
reset role;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a4';
select counter_checkin('40000000-0000-0000-0000-000000000002')->'plan'->>'remaining_count' as tch_remaining;
reset role;
\echo '--- 同意書改版後需重簽'
insert into waiver_versions (version,title,content,effective_date) values ('2026.2','同意書','新版', current_date);
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a4';
select counter_checkin('40000000-0000-0000-0000-000000000002')->>'result' as after_new_version;
reset role;
\echo '--- 已簽過的版本不能改內容'
update waiver_versions set content='改' where version='2026.1';
