# 資料庫更新 0008～0015

> ✅ **2026-09-30 老闆已全部執行完成。** 之後有新的更新檔會再列在這裡。

> 2026-09-30 整理。**一定要照順序一個一個執行**，執行完一個打勾再做下一個。

## 怎麼執行（每個檔案都一樣）

1. 在 GitHub 打開檔案（`supabase/migrations/` 資料夾裡）。
2. 按右上角的**複製圖示**（Copy raw file），複製全部內容。
   - 不要用滑鼠拖曳選取，容易少複製到最後幾行。
3. 到 Supabase 後台 → 左邊 **SQL Editor** → **+ New query**。
4. 貼上 → 按右下角 **Run**。
5. 看到 **Success. No rows returned** 就是成功，打勾，換下一個。
   - 如果出現紅字錯誤：**不要繼續執行下一個**，把錯誤訊息截圖傳給我。

## 清單

| ✓ | 順序 | 檔名 | 行數 | 做什麼 |
|---|---|---|---|---|
| ✅ | 0008 | `20260929000008_categories_and_zl_cleanup.sql` | 72 | 品項改成設計稿的 6 類分類；刪除中壢店（原 A19）的品項 |
| ✅ | 0009 | `20260929000009_kiosk_admin.sql` | 24 | 入場機讀取分館設定（名稱、音量） |
| ✅ | 0010 | `20260929000010_reports.sql` | 75 | 報表「總覽」 |
| ✅ | 0011 | `20260930000011_member_app.sql` | 108 | 會員 App（首頁、入場紀錄） |
| ✅ | 0012 | `20260930000012_reports_more.sql` | 351 | 報表擴充（銷售、入場、月／年比較、會員名單、未使用餘額） |
| ✅ | 0013 | `20260930000013_course_groups.sql` | 137 | 課程統計分類與教練；入場分三類 |
| ✅ | 0014 | `20260930000014_plan_adjust_and_audit_view.sql` | 136 | 調整次數、異動紀錄 |
| ✅ | 0015 | `20260930000015_staff_activity.sql` | 98 | 員工使用足跡 |

「行數」可以用來確認有沒有複製完整：貼到 SQL Editor 後，看左邊最後一行的行號是否一樣（相差一兩行沒關係）。

## 全部執行完之後

- [ ] 部署帳號管理功能 `admin-users`（見 `docs/setup-admin.md` 步驟 2）
- [ ] 後台品項管理：幫每個課程填「使用期限」「統計分類」「教練」
- [ ] 後台分館與入場機：填各店固定零用金、國定假日

---

# 0016（✅ 2026-10-01 已執行）

| ✓ | 順序 | 檔名 | 行數 | 做什麼 |
|---|---|---|---|---|
| ✅ | 0016 | `20261001000016_walkin_single_tickets.sql` | 252 | 非會員可以直接買單次票，並自動記入今日入場 |

---

# 0017～0020（✅ 2026-10-03 已執行，admin-users 已重新部署）

| ✓ | 順序 | 檔名 | 行數 | 做什麼 |
|---|---|---|---|---|
| ✅ | 0017 | `20261001000017_inventory.sql` | 417 | 庫存：進貨、賣出自動扣、盤點（差異由店長確認）、調撥、報廢 |
| ✅ | 0018 | `20261002000018_accounting_report.sql` | 123 | 後台「報表 → 會計」：每月給會計的消費總額、每日彙總、發票明細、退款明細；新增「會計」帳號角色 |
| ✅ | 0019 | `20261002000019_member_tags.sql` | 166 | 顧客標籤（有顏色）與行為紀錄 |
| ✅ | 0020 | `20261002000020_guests_and_shared_passes.sql` | 543 | 非會員簽安全守則（姓名、手機、簽名）；十次券每掃一次扣一次；年月票入場顯示大頭照 |

執行完之後還要：

- [x] **重新部署** `admin-users`（新增「會員 App 測試密碼」與「會計帳號」功能）：照 `docs/setup-admin.md` 步驟 2，把新的程式碼整個貼上取代舊的，按 Deploy；「Verify JWT with legacy secret」維持**關閉**
- [ ] 後台品項管理：要管庫存的商品（類型選「商品／租借」）勾「管理庫存」

---

# 0021～0022（⏳ 待執行，2026-10-02 同事回饋）

**一定要分兩次執行**：先執行 0021，看到 Success 後，再開一個新的 query 執行 0022（0021 新增的選項要先存好）。

| ✓ | 順序 | 檔名 | 行數 | 做什麼 |
|---|---|---|---|---|
| ⬜ | 0021 | `20261003000021_new_options.sql` | 12 | 新增選項：商品、轉帳、捐贈 |
| ⬜ | 0022 | `20261003000022_counter_feedback.sql` | 573 | 商品與租借分開、轉帳、捐贈發票、可轉讓設定、方案轉讓費 |

執行完之後：到品項管理把「方案轉讓費」設成要收的金額（0 元＝不收）。

---

## 檢查資料庫更新有沒有都執行（隨時可用，只查看、不會改資料）

```sql
select '0008' as 更新, exists (select 1 from information_schema.columns where table_name = 'product_categories' and column_name = 'dot_color') as 已執行
union all select '0009', to_regprocedure('public.kiosk_info()') is not null
union all select '0010', to_regprocedure('public.sales_report(date,date,uuid)') is not null
union all select '0011', to_regprocedure('public.my_app_home()') is not null
union all select '0012', to_regprocedure('public.report_sales(date,date,uuid)') is not null
union all select '0013', exists (select 1 from information_schema.columns where table_name = 'products' and column_name = 'report_group')
union all select '0014', to_regprocedure('public.adjust_plan_count(uuid,integer,text)') is not null
union all select '0015', to_regclass('public.staff_activity') is not null
union all select '0016', exists (select 1 from information_schema.columns where table_name = 'checkins' and column_name = 'order_item_id')
union all select '0017', to_regclass('public.stock_movements') is not null
union all select '0018', to_regprocedure('public.report_accounting(date,date,uuid)') is not null
union all select '0019', to_regclass('public.member_tags') is not null
union all select '0020', to_regclass('public.guest_waivers') is not null
union all select '0021', exists (select 1 from pg_enum where enumlabel = 'transfer')
union all select '0022', exists (select 1 from information_schema.columns where table_name = 'products' and column_name = 'transferable');
```
