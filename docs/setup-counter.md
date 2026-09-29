# 在自己的電腦上試用櫃檯系統（老闆操作說明）

大約 20 分鐘。做完以後，就能在電腦的瀏覽器，或同一個 Wi-Fi 底下的平板上試用櫃檯系統。

> 這是「試用」：系統只會在您的電腦開著時運作。之後我們會把它放上 Netlify，就能 24 小時從任何地方使用。

---

## 步驟 1：在 Supabase 執行資料庫更新（2 分鐘）

跟之前一樣，到 Supabase 的 **SQL Editor** → **+ New query**，依序貼上以下檔案的內容後按 **Run**（已經執行過的就跳過）：

1. `supabase/migrations/20260929000006_branch_color.sql`：分館顏色
2. `supabase/migrations/20260929000007_decisions_update.sql`：2026-09-29 決策調整
3. `supabase/migrations/20260929000008_categories_and_zl_cleanup.sql`：品項改成 6 類、刪除中壢（原 A19）品項

---

## 步驟 2：把程式下載到 `C:\origin-system`（5 分鐘）

> **在一台全新的電腦（例如筆電）上**：不需要先準備任何檔案，改用下面「全新電腦」的做法即可。
>
> 1. 先確認有安裝 Git 和 Node.js：在 PowerShell 輸入 `git --version` 和 `node --version`，各自出現版本號碼就是有安裝。
>    - 沒有 Git：到 <https://git-scm.com/download/win> 下載安裝，全部按「Next」即可。
>    - 沒有 Node.js：到 <https://nodejs.org> 下載「LTS」版本安裝。
>    - 安裝完**關掉 PowerShell 再重新打開**。
> 2. 在 PowerShell 貼上這兩行（會自動建立 `C:\origin-system` 並下載全部檔案，包含設計稿）：
>
> ```powershell
> cd C:\
> git clone -b claude/yuanyan-climbing-database-kqjhqv https://github.com/yammincode/Tupuser.git origin-system
> ```
>
> 完成後直接跳到步驟 3。下面的指令是給「原本就有 `C:\origin-system` 資料夾」的電腦用的。

1. 按鍵盤的 **Windows 鍵**，輸入 `PowerShell`，打開「Windows PowerShell」。
2. 依序**一行一行**貼上下面的指令，每行貼上後按 **Enter**：

```powershell
cd C:\origin-system
Rename-Item design design-old
git init
git remote add origin https://github.com/yammincode/Tupuser.git
git fetch origin claude/yuanyan-climbing-database-kqjhqv
git checkout -b claude/yuanyan-climbing-database-kqjhqv origin/claude/yuanyan-climbing-database-kqjhqv
```

- 如果跳出 GitHub 登入視窗，請用您的 GitHub 帳號登入。
- 第 2 行會把電腦裡原本的 `design` 資料夾改名成 `design-old`，因為 GitHub 上已經有同一份設計稿，下載時會放回 `design` 資料夾。確認新的 `design` 資料夾內容沒問題後，`design-old` 可以刪掉。
- 如果第 3 行出現 `remote origin already exists`，代表之前設定過，可以直接執行下一行。

完成後，`C:\origin-system` 裡會多出 `docs`、`supabase`、`web` 等資料夾。

---

## 步驟 3：設定連線資料（3 分鐘）

櫃檯系統需要知道要連到哪一個 Supabase 資料庫。

1. 到 Supabase 後台，左下角點 **Project Settings**（齒輪），再點 **API**（有些版本叫 **Data API** 或 **API Keys**）。
2. 找到兩樣東西：
   - **Project URL**：像 `https://abcdefgh.supabase.co`
   - **anon public** 或 **publishable** 金鑰：一長串英文數字
3. 回到 PowerShell，輸入：

```powershell
cd C:\origin-system\web
copy .env.example .env
notepad .env
```

4. 記事本打開後，把兩行改成您的資料，例如：

```
VITE_SUPABASE_URL=https://abcdefgh.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...（您的 anon 金鑰）
```

5. 按 `Ctrl + S` 存檔，關閉記事本。

> **這個金鑰可以放心使用**：anon／publishable 金鑰本來就是給畫面用的公開金鑰，真正保護資料的是資料庫裡的權限規則。
> ⚠ 但是**千萬不要**用 **service_role** 或 **secret** 那一把，那是萬用鑰匙。

---

## 步驟 4：啟動櫃檯系統（5 分鐘，第一次比較久）

在同一個 PowerShell 視窗輸入：

```powershell
npm install
npm run dev
```

> **如果出現紅字「因為這個系統上已停用指令碼執行，所以無法載入 …npm.ps1」**：這是 Windows 的安全設定。
> 貼上下面這行按 Enter，問「是否要變更」時輸入 `Y`，之後就能正常執行（每台電腦只要做一次）：
>
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
> ```
>
> 不想改設定的話，也可以改打 `npm.cmd install`、`npm.cmd run dev`。

- `npm install`：下載需要的套件，只有第一次需要，大約 1～3 分鐘。
- `npm run dev`：啟動系統。畫面會出現類似這樣的文字：

```
  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.1.23:5173/
```

**PowerShell 視窗不要關**，關掉系統就停了。

---

## 步驟 5：打開來試用

- **在這台電腦上**：打開 Chrome，網址輸入 `http://localhost:5173`
- **在平板上**（要跟電腦連同一個 Wi-Fi）：在平板瀏覽器輸入上面 `Network:` 那一行的網址，例如 `http://192.168.1.23:5173`
  - 如果 Windows 跳出「防火牆」詢問視窗，請選 **允許存取**。

用您的**總部帳號**（Email ＋ 密碼）登入 → 選一間分館 → 系統會自動播放導覽。

---

## 下次要再打開

```powershell
cd C:\origin-system\web
npm run dev
```

## 取得最新版本（我更新程式之後）

```powershell
cd C:\origin-system
git pull
cd web
npm install
npm run dev
```

## 遇到問題

把 PowerShell 或畫面上的錯誤訊息截圖給我就好。
