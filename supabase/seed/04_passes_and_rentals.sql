-- =====================================================================
-- 補充品項：十次券、月票、岩鞋租借、粉袋租借（所有分館通用、不限日期時段）
-- 可重複執行：同名品項已存在就不會重複建立。
-- =====================================================================
-- 分類（設計稿的「套票・年月票」「裝備租借」）已由 03_products.sql 建立

insert into public.products (name, category_id, price, content_type, quantity, usage_rule, all_branches, sort_order)
select v.name, pc.id, v.price, v.content_type::public.content_type, v.quantity, 'any', true, v.sort_order
from (values
  ('十次券',   '套票・年月票', 3800, 'punch',  10, 5000),
  ('月票',     '套票・年月票', 2600, 'days',   30, 5010),
  ('岩鞋租借', '裝備租借',  100, 'rental',  1, 6000),
  ('粉袋租借', '裝備租借',  100, 'rental',  1, 6010)
) as v(name, category, price, content_type, quantity, sort_order)
join public.product_categories pc on pc.name = v.category
where not exists (select 1 from public.products p where p.name = v.name);

select p.name as 品名, pc.name as 分類, p.price as 價格,
       case p.content_type when 'punch' then p.quantity || ' 次' when 'days' then p.quantity || ' 天'
                           else '—' end as 內容
from public.products p join public.product_categories pc on pc.id = p.category_id
where pc.name in ('套票・年月票', '裝備租借') and p.name in ('十次券', '月票', '岩鞋租借', '粉袋租借') order by p.sort_order;
