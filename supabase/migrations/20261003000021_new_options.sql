-- =====================================================================
-- 原岩攀岩館 會員與櫃檯系統
-- 第 21 部分：新增選項（同事回饋 2026-10-02，老闆確認）
--   這個檔案只新增選項，請單獨執行完，再執行 0022（新選項要先存好才能在下一個檔案使用）
--   content_type  加「goods 商品」（和「rental 租借」分開）
--   payment_method 加「transfer 轉帳」
--   invoice_type  加「donation 捐贈」
-- =====================================================================

alter type public.content_type add value if not exists 'goods';
alter type public.payment_method add value if not exists 'transfer';
alter type public.invoice_type add value if not exists 'donation';
