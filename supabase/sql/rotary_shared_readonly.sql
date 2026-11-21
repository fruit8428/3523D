-- ============================================================
-- 在「Rotary-Shared」專案執行（不是各地區自己的專案）
-- 把全球獎助金資料表 global_grants 設成「公開唯讀」：
--   任何人（公開金鑰）只能讀取，不能新增、修改、刪除；由資料庫本身擋住。
--   爬蟲用的私密金鑰不受影響，照常可以寫入。
-- 可以重複執行。
-- ============================================================
alter table public.global_grants enable row level security;

revoke all on public.global_grants from anon, authenticated;
grant select on public.global_grants to anon, authenticated;

drop policy if exists "public read only" on public.global_grants;
create policy "public read only" on public.global_grants
    for select to anon, authenticated using (true);

-- 執行後會顯示結果：應該只有一列，權限欄只有 SELECT
select
    (select relrowsecurity from pg_class where oid = 'public.global_grants'::regclass) as "保護已開啟",
    (select string_agg(distinct privilege_type, ', ') from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'global_grants' and grantee = 'anon') as "公開金鑰的權限",
    (select string_agg(policyname || '（' || cmd || '）', ', ') from pg_policies
      where schemaname = 'public' and tablename = 'global_grants') as "規則";
