# 由價目表產生 supabase/seed/03_products.sql
# 用法：python3 supabase/seed/tools/gen_products.py > supabase/seed/03_products.sql
CATS = [  # 名稱, 底色, 文字色, 小色點（依 design/ 設計稿）
    ("平日入場", "#F7ECC8", "#5A4106", "#C99A1E"),
    ("假日入場", "#DCEBE4", "#173F32", "#2F6B57"),
    ("兒童", "#F5DDE6", "#6B1F3D", "#B94A77"),
    ("套票・年月票", "#F6DDD2", "#6E2A12", "#B24A22"),
    ("新手與活動", "#DCE4F0", "#1F3A63", "#3B62A0"),
    ("裝備租借", "#E9E5DD", "#2F2B25", "#6B655C"),
]
rows = []  # (分類, 品名, 價格, 類型, 數量, 日期規則, 開始, 結束, 分館代碼 list 或 None)

def s(branch, cat, name, price, rule, start=None, end=None):
    # 成人／學生票依平日、假日分類；兒童票歸「兒童」；單純入場歸「裝備租借」（老闆 2026-09-29 確認）
    if cat in ("成人票", "學生票"):
        cat = "假日入場" if rule == "weekend" else "平日入場"
    elif cat == "兒童幼兒票":
        cat = "兒童"
    elif cat == "陪同入場":
        cat = "裝備租借"
    rows.append((cat, name, price, "single", 1, rule, start, end, [branch]))

# ---------- 平日（明德、萬華、南港、中和：同一種票型） ----------
four = {
    #      全天(開始,價)   白天(開始,價)  晚上 星光 | 學生 全 白 晚 星 | 兒童 幼兒
    "MD": ("12:00", 500, "12:00", 350, 450, 320, 350, 280, 300, 250, 250, 200),
    "WH": ("10:00", 450, "10:00", 350, 420, 320, 350, 280, 300, 250, 250, 200),
    "NG": ("12:00", 450, "12:00", 320, 400, 300, 350, 250, 300, 250, 250, 200),
    "ZH": ("12:00", 500, "12:00", 350, 450, 320, 400, 250, 320, 250, 250, 200),
}
for b, (fs, fa, ds, da, na, sa, sf, sd, sn, ss, kid, tod) in four.items():
    s(b, "成人票", "平日 成人全天", fa, "weekday")
    s(b, "成人票", "平日 成人白天", da, "weekday", ds, "18:00")
    s(b, "成人票", "平日 成人晚上", na, "weekday", "17:00", "23:00")
    s(b, "成人票", "平日 成人星光", sa, "weekday", "20:30", "23:00")
    s(b, "學生票", "平日 學生全天", sf, "weekday")
    s(b, "學生票", "平日 學生白天", sd, "weekday", ds, "18:00")
    s(b, "學生票", "平日 學生晚上", sn, "weekday", "17:00", "23:00")
    s(b, "學生票", "平日 學生星光", ss, "weekday", "20:30", "23:00")
    if b == "WH":
        s(b, "兒童幼兒票", "平日 兒童早鳥", 200, "weekday", "10:00", "13:00")
    s(b, "兒童幼兒票", "平日 兒童全天", kid, "weekday")
    s(b, "兒童幼兒票", "平日 幼兒全天", tod, "weekday")

# ---------- 假日（明德、萬華、南港、中和） ----------
four_we = {  # 成人全天, 星光開始, 星光結束, 成人星光, 學生全天, 學生星光
    "MD": (550, "19:30", "22:00", 320, 350, 250),
    "WH": (500, "18:30", "21:00", 320, 350, 250),
    "NG": (450, "18:30", "21:00", 300, 350, 250),
    "ZH": (550, "19:00", "22:00", 320, 400, 250),
}
for b, (fa, st, en, sa, sf, ss) in four_we.items():
    s(b, "成人票", "假日 成人全天", fa, "weekend")
    s(b, "成人票", "假日 成人星光", sa, "weekend", st, en)
    s(b, "學生票", "假日 學生全天", sf, "weekend")
    s(b, "學生票", "假日 學生星光", ss, "weekend", st, en)
    s(b, "兒童幼兒票", "假日 兒童全天", 250, "weekend")
    s(b, "兒童幼兒票", "假日 幼兒全天", 200, "weekend")

# 中壢店（原 A19）已結束營業，不建立品項；中壢開幕前再設定（老闆 2026-09-29 確認）

# ---------- 新店 ----------
b = "XD"
s(b, "成人票", "平日 成人全天", 500, "weekday")
s(b, "成人票", "平日 成人三小時", 400, "weekday")
s(b, "成人票", "平日 成人星光", 300, "weekday", "20:30", "23:00")
s(b, "學生票", "平日 學生全天", 400, "weekday")
s(b, "學生票", "平日 學生三小時", 300, "weekday")
s(b, "學生票", "平日 學生星光", 250, "weekday", "20:30", "23:00")
s(b, "兒童幼兒票", "平日 兒童全天", 250, "weekday")
s(b, "成人票", "假日 成人全天", 550, "weekend")
s(b, "成人票", "假日 成人三小時", 400, "weekend")
s(b, "成人票", "假日 成人星光", 300, "weekend", "19:00", "22:00")
s(b, "學生票", "假日 學生全天", 400, "weekend")
s(b, "學生票", "假日 學生三小時", 300, "weekend")
s(b, "學生票", "假日 學生星光", 250, "weekend", "19:00", "22:00")
s(b, "兒童幼兒票", "假日 兒童兩小時（含裝備）", 500, "weekend")
s(b, "兒童幼兒票", "假日 兒童三小時（含裝備）", 600, "weekend")

# ---------- 單純入場（不攀爬），各館 100 元 ----------
for b in ["MD", "WH", "NG", "ZH", "XD"]:
    s(b, "陪同入場", "單純入場（不攀爬）", 100, "any")

# ---------- 課程（採 2024/01 現行價格） ----------
def c(cat, name, price, lessons, branches):
    rows.append(("新手與活動", name, price, "course", lessons, "any", None, None,
                 None if branches is None else [b for b in branches if b != "ZL"]))

W_N_M = ["WH", "NG", "MD"]
c("團體課程", "幼兒課（6堂）", 2500, 6, W_N_M)
c("團體課程", "幼兒課（6堂）", 3000, 6, ["ZH"])
c("團體課程", "幼兒課 單堂試上", 500, 1, W_N_M)
c("團體課程", "幼兒課 單堂試上", 600, 1, ["ZH"])
c("團體課程", "兒童課（6堂）", 3600, 6, W_N_M)
c("團體課程", "兒童課（6堂）", 4000, 6, ["ZH"])
c("團體課程", "兒童課（6堂）", 4200, 6, ["XD"])
c("團體課程", "兒童課 單堂試上", 750, 1, W_N_M)
c("團體課程", "兒童課 單堂試上", 800, 1, ["ZH", "XD"])
c("團體課程", "青少年課（6堂）", 4200, 6, ["WH", "MD"])
c("團體課程", "青少年課（6堂）", 4500, 6, ["ZH", "XD"])
c("團體課程", "青少年課 單堂試上", 900, 1, ["WH", "MD"])
c("團體課程", "青少年訓練課（8堂）", 6000, 8, ["ZH", "XD"])
c("團體課程", "成人抱石課 新生（4堂）", 4500, 4, ["WH", "NG", "MD"])
c("團體課程", "成人抱石課 舊生（4堂）", 4200, 4, ["WH", "NG", "MD"])
c("團體課程", "成人技巧課（4堂）", 5000, 4, ["ZH", "XD"])
c("團體課程", "成人初岩課（5堂）", 5500, 5, ["ZH", "XD"])
c("團體課程", "成人先鋒課（6堂）", 7500, 6, ["ZH", "XD"])
c("團體課程", "親子抱石課（4堂，每人）", 3900, 4, ["WH", "NG", "MD", "XD"])
c("團體課程", "親子課（4堂，每人）", 4500, 4, ["ZH"])
c("團體課程", "系統轉換課", 2000, 1, ["ZH"])
c("團體課程", "原岩攀岩隊（8堂）", 4000, 8, None)
c("一對一課程", "特殊生一對一 兒童／幼兒（8堂）", 4800, 8, None)
c("一對一課程", "一對一 兒童／青少年（4堂）", 5000, 4, None)
c("一對一課程", "一對一 成人（4堂）", 6000, 4, None)
c("一對一課程", "一對一 初岩確保（5堂）", 10000, 5, ["ZH", "XD"])
c("一對一課程", "一對一 先鋒確保（6堂）", 12000, 6, ["ZH", "XD"])

def q(v):
    return "null" if v is None else "'" + str(v).replace("'", "''") + "'"

out = []
out.append("""-- =====================================================================
-- 品項初始資料（由 supabase/seed/tools/gen_products.py 依價目表產生，請勿手動修改）
-- 價格來源：老闆提供的入場價目表與課程價目表（課程採 2024/01 現行價格）\n-- 分類依 design/ 設計稿 6 類；中壢店（原 A19）不建立品項
-- 只會在「還沒有任何品項」時執行；已經有品項就整段跳過，不會重複建立。
-- =====================================================================
do $seed$
begin
  if exists (select 1 from public.products) then
    raise notice '已經有品項資料，跳過';
    return;
  end if;
""")
out.append("  insert into public.product_categories (name, bg_color, text_color, dot_color, sort_order) values")
out.append(",\n".join(f"    ({q(n)}, {q(bg)}, {q(fg)}, {q(dot)}, {i+1})" for i, (n, bg, fg, dot) in enumerate(CATS))
           + "\n  on conflict (name) do nothing;\n")
out.append("""  create temp table seed_products (
    sort_order int, category text, name text, price int, content_type public.content_type,
    quantity int, usage_rule public.usage_rule, slot_start time, slot_end time, branch_codes text[]
  ) on commit drop;
  insert into seed_products values""")
vals = []
for i, (cat, name, price, ct, qty, rule, st, en, br) in enumerate(rows):
    brs = "null" if br is None else "array[" + ",".join(q(x) for x in br) + "]"
    vals.append(f"    ({(i+1)*10}, {q(cat)}, {q(name)}, {price}, '{ct}', {qty}, '{rule}', {q(st)}, {q(en)}, {brs})")
out.append(",\n".join(vals) + ";\n")
out.append("""  with ins as (
    insert into public.products (name, category_id, price, content_type, quantity, usage_rule,
                                 slot_start, slot_end, all_branches, sort_order)
    select sp.name, pc.id, sp.price, sp.content_type, sp.quantity, sp.usage_rule,
           sp.slot_start, sp.slot_end, sp.branch_codes is null, sp.sort_order
    from seed_products sp join public.product_categories pc on pc.name = sp.category
    returning id, sort_order
  )
  insert into public.product_branches (product_id, branch_id)
  select ins.id, b.id
  from ins
  join seed_products sp on sp.sort_order = ins.sort_order
  join public.branches b on b.code = any (sp.branch_codes);
end $seed$;

-- 檢查結果：每間分館可以賣的品項數
select b.code as 代碼, b.name as 分館, count(p.id) as 品項數
from public.branches b
left join public.products p
  on p.all_branches or exists (select 1 from public.product_branches pb
                               where pb.product_id = p.id and pb.branch_id = b.id)
group by b.code, b.name, b.sort_order
order by b.sort_order;
""")
print("\n".join(out))
