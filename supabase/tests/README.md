# 資料庫測試（工程用）

在本機 PostgreSQL 16 模擬 Supabase，跑一遍所有情境：

```bash
createdb oytest
psql -d oytest -v ON_ERROR_STOP=1 -f supabase/tests/00_supabase_stub.sql
for f in supabase/migrations/*.sql; do psql -d oytest -v ON_ERROR_STOP=1 -f "$f"; done
psql -d oytest -f supabase/tests/10_scenarios.sql
```

`10_scenarios.sql` 會以總部、店長、櫃檯、入場機、會員等不同身分操作。
標示「應被擋」的步驟出現 `ERROR` 才是正確結果（目前共 11 個）。
