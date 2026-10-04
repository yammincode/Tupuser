# 資料庫測試（工程用）

在本機 PostgreSQL 16 模擬 Supabase，跑一遍所有情境：

```bash
createdb oytest
psql -d oytest -v ON_ERROR_STOP=1 -f supabase/tests/00_supabase_stub.sql
for f in supabase/migrations/*.sql; do psql -d oytest -v ON_ERROR_STOP=1 -f "$f"; done
psql -d oytest -f supabase/tests/10_scenarios.sql
```

`10_scenarios.sql` 會以總部、店長、櫃檯、入場機、會員等不同身分操作。
標示「應被擋」的步驟出現 `ERROR` 才是正確結果（目前共 12 個）。
接著可執行 `psql -d oytest -f supabase/tests/30_batch3.sql`（第 24 部分：庫存管理、費用訂單、暫停期間；7 個應被擋）。

`20_decisions.sql` 需要在 `npx supabase start` 的完整本機環境執行（先建立 hq／cashier／manager／kiosk 測試帳號），測試 2026-09-29 的決策調整：同意書三個勾選、QR 指定方案、入場機畫面、退款權限、方案異動、店長品項、關帳品項銷售。
