# 上線部署：把系統放上網路（老闆操作說明）

大約 15 分鐘，只要設定一次。完成後各分館的平板打開網址就能用，**不用再開您的電腦**。

之後每次程式更新（推上 GitHub），Netlify 會**自動重新部署**，約 1～2 分鐘後網站就是新版。

> **什麼是 Netlify？** 一個放網站的服務（網站主機）。免費方案就夠用。
> 它會從 GitHub 拿程式、自動打包好放上網，給您一個 `https://....netlify.app` 的網址。

---

## 步驟 1：確認資料庫已經更新

Supabase SQL Editor 裡，migration 0008、0009、0010 都要執行過（見 `docs/setup-admin.md` 步驟 1）。
帳號管理功能（Edge Function `admin-users`）也要部署好（同一份文件步驟 2）。

## 步驟 2：準備兩個值

到 Supabase 後台 → 左下角 **Project Settings**（齒輪）→ **API**（或 **API Keys**／**Data API**），找到：

| 名稱 | 長什麼樣子 |
|---|---|
| Project URL（專案網址） | `https://xxxxxxxx.supabase.co` |
| **anon public** 或 **publishable** 金鑰 | `eyJhbGciOi...` 或 `sb_publishable_...` 開頭的一長串 |

> ⚠️ **不要用** 寫著 **service_role** 或 **secret** 的金鑰。那是最高權限金鑰，放上網站等於把鑰匙交給所有人。
> （就算不小心貼錯，網站也會顯示「金鑰填錯了」而不會啟動。）

如果您筆電上已經照 `docs/setup-counter.md` 建好 `web\.env.local`，裡面就是這兩個值，可以直接複製。

## 步驟 3：建立 Netlify 網站

1. 打開 <https://app.netlify.com/signup>，選 **Sign up with GitHub**（用 GitHub 帳號註冊），照畫面授權。
2. 登入後按 **Add new project**（或 **Add new site**）→ **Import an existing project**。
3. 選 **GitHub**。第一次會跳出授權視窗，選擇讓 Netlify 讀取 **Tupuser** 這個專案（Only select repositories → Tupuser）。
4. 在清單中點 **Tupuser**。
5. 設定畫面：
   - **Branch to deploy**（要部署的分支）：選 `claude/yuanyan-climbing-database-kqjhqv`
   - 其他欄位（Base directory、Build command、Publish directory）**不用填**，專案裡的 `netlify.toml` 已經設定好了。
6. 往下找到 **Environment variables**（環境變數）→ **Add environment variables**，新增兩個：

   | Key（名稱，一字不差） | Value（值） |
   |---|---|
   | `VITE_SUPABASE_URL` | 步驟 2 的 Project URL |
   | `VITE_SUPABASE_ANON_KEY` | 步驟 2 的 anon／publishable 金鑰 |

7. 按 **Deploy**（部署）。等 1～2 分鐘，出現 **Published**（已發布）就完成了。

> 如果第 6 步沒看到環境變數的欄位：先按 Deploy，完成後到 **Site configuration → Environment variables** 新增，
> 再到 **Deploys** → **Trigger deploy → Deploy site** 重新部署一次。

## 步驟 4：改一個好記的網址（選做）

Netlify 預設網址是亂數（例如 `https://jolly-otter-12345.netlify.app`）。

**Site configuration → General → Site details → Change site name**，改成例如 `origin-climbing`，
網址就變成 `https://origin-climbing.netlify.app`。

（之後若想用自己的網域，例如 `app.origin.tw`，可以在 **Domain management** 設定，需要另外購買網域。）

## 步驟 5：打開看看

| 系統 | 網址 |
|---|---|
| 櫃檯 | `https://您的網址.netlify.app/counter` |
| 入場機 | `https://您的網址.netlify.app/kiosk` |
| 總部後台 | `https://您的網址.netlify.app/admin` |

用平常的帳號登入，確認資料和在電腦上試用時一樣。

## 步驟 6：設定各分館的平板

- **櫃檯平板**：用 Chrome（或 iPad 的 Safari）打開 `/counter`，登入後按瀏覽器選單的「**加到主畫面**」，之後點桌面圖示就能開。
- **入場機平板**：用 Fully Kiosk Browser，把「Start URL（開機網址）」設成 `https://您的網址.netlify.app/kiosk`，
  用入場機帳號登入一次即可（詳見 `docs/setup-admin.md` 步驟 4）。

> **系統更新後**：櫃檯重新整理一次頁面就是新版。入場機建議在 Fully Kiosk 設定每天清晨自動重新載入
> （重新載入後需要有人點一下「開始使用」，才能播放提示音）。

---

## 常見問題

**Q：網站打開顯示「尚未設定 Supabase 連線」？**
環境變數沒填或名稱打錯。到 **Site configuration → Environment variables** 檢查兩個名稱是否一字不差，改好後 **Trigger deploy** 重新部署。

**Q：打開顯示「金鑰填錯了」？**
填到 service_role／secret 金鑰了，請改成 anon／publishable 金鑰，再重新部署。

**Q：每次開發更新都會馬上影響分館嗎？**
會。目前還在開發測試階段所以沒關係。**開始試跑前**，我們會改成另一個「正式版」分支：開發中的修改先在測試網址確認，老闆同意後才更新到分館。

**Q：要付費嗎？**
目前不用。Netlify 免費方案每月有固定的用量額度，這個系統的網頁很小，一般用不完；快用完時 Netlify 會寄信通知。
