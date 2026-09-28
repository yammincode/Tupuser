# 在 Supabase 建立資料庫（老闆操作說明）

整個過程都在瀏覽器裡完成，不需要安裝任何東西，大約 15 分鐘。

## 步驟 1：註冊 Supabase 並建立專案

1. 打開 <https://supabase.com>，按右上角 **Start your project**，用 GitHub 帳號登入最方便。
2. 按 **New project**，填寫：
   - **Name**：`origin-system`
   - **Database Password**：按 **Generate a password** 產生一組密碼，**一定要抄下來存好**（之後搬 17FIT 資料會用到）。
   - **Region**：選 **Northeast Asia (Tokyo)**（離台灣最近，速度最快）。
   - **Plan**：先選 Free 就可以。正式上線前建議升級 Pro（每月約 25 美元），因為免費版一週沒人使用會自動暫停，而且沒有每日備份。
3. 按 **Create new project**，等 1～2 分鐘，畫面出現專案首頁就好了。

## 步驟 2：執行 4 個建立資料庫的檔案

要依照順序執行以下 4 個檔案（都在 GitHub 專案的 `supabase/migrations/` 資料夾裡）：

1. `20260928000001_schema.sql`：建立資料表
2. `20260928000002_functions.sql`：結帳、入場、退款、關帳等規則
3. `20260928000003_rls.sql`：權限
4. `20260928000004_storage.sql`：大頭照、簽名圖的檔案空間

每個檔案的做法都一樣：

1. 在 GitHub 打開這個檔案，按右上角的 **複製圖示**（Copy raw file），把整份內容複製起來。
2. 回到 Supabase，左邊選單按 **SQL Editor**，再按 **+ New query**（新增查詢）。
3. 在空白處貼上，按右下角綠色的 **Run**（或按 `Ctrl + Enter`）。
4. 下方出現 **Success. No rows returned** 就是成功了。
5. 如果出現紅色錯誤訊息，**不要繼續下一個檔案**，把錯誤訊息截圖給我。

> 如果 Supabase 跳出警告視窗，說這段指令「會修改資料」或「含有具破壞性的操作」，按 **Run this query** 繼續即可。

## 步驟 3：確認結果

左邊選單按 **Table Editor**，應該會看到這些資料表：

`audit_logs`、`branches`、`checkins`、`daily_closings`、`devices`、`holidays`、`member_plans`、`members`、`order_items`、`orders`、`payments`、`product_branches`、`product_categories`、`products`、`refunds`、`staff`、`waiver_signatures`、`waiver_versions`

共 18 張。表格旁邊如果出現 **RLS enabled** 或盾牌圖示，就代表權限保護已經開啟。

完成後告訴我，我們再進行下一步：建立分館、您的總部帳號和第一版同意書。
