-- 活動歷屆備份（2026-11-20）
-- 最高管理員在「📦 歷屆備份與清空本活動」按下「備份並清空」時，先把該活動的報名表、繳費紀錄、銀行入帳、報到紀錄
-- 存成一筆備份，確認寫入成功後才清空。接手的主委可以查看上一屆的狀況，也留作歷年統計。
-- 只能新增與讀取，不能修改或刪除（沒有 update／delete 的 policy），所以備份不會被網頁端改掉或刪掉。
-- 內容與 app_storage 裡原本就公開的報名資料相同；旅平險個資不在裡面。可重複執行。
create table if not exists public.event_archives (
    id          bigint generated always as identity primary key,
    event_key   text not null,                       -- 大類id::子活動名稱
    cat_name    text not null default '',
    sub_name    text not null default '',
    label       text not null default '',            -- 屆別／年度，例如「2026-27 年度」
    archived_at timestamptz not null default now(),
    archived_by text not null default '',
    summary     jsonb not null default '{}'::jsonb,  -- 備份當下的統計（報名社數、人數、已繳社數、金額…）
    data        jsonb not null                       -- 完整資料
);
create index if not exists event_archives_key_idx on public.event_archives (event_key, archived_at desc);
alter table public.event_archives enable row level security;
drop policy if exists "anon read event_archives"   on public.event_archives;
drop policy if exists "anon insert event_archives" on public.event_archives;
create policy "anon read event_archives"   on public.event_archives for select to anon using (true);
create policy "anon insert event_archives" on public.event_archives for insert to anon with check (true);
revoke update, delete, truncate on public.event_archives from anon, authenticated;
grant select, insert on public.event_archives to anon;
notify pgrst, 'reload schema';
