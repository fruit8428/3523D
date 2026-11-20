-- ============================================================
-- 社費推播：執秘用 LINE 把「每位社友自己的社費明細」推給社友
-- ============================================================
-- 每人的金額與品項是個資，不可以放進 app_storage（前端讀得到＝公開）。
-- 這兩張表 RLS 開啟、不建立 policy、收回 anon 權限＝前端完全讀不到，只有雲端小程式 line-checkin 能讀寫。
-- 哪些社可以用，沿用行事曆後台「④-2 各社推播開放」（calendar_club_push），所以要先跑過 calendar_club_remind.sql。
-- 可以重複執行。

-- 每社一列：上次發送時填的內容（共同品項＋個別品項），下次打開自動帶出
create table if not exists public.club_dues_state (
    club_name  text primary key,
    data       jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
);
alter table public.club_dues_state enable row level security;
revoke all on public.club_dues_state from anon, authenticated;

-- 發送紀錄（只記人數與總金額，不記每個人的明細）
create table if not exists public.club_dues_log (
    id            bigserial primary key,
    club_name     text not null,
    period        text not null default '',
    target_count  int not null default 0,     -- 小計不是 0 的社友人數
    sent_count    int not null default 0,
    failed_count  int not null default 0,
    unbound_count int not null default 0,     -- 沒綁定 LINE、收不到的人數
    total_amount  bigint not null default 0,  -- 這次所有人的小計加總
    content_hash  text not null default '',   -- 用來擋「60 秒內重複送出一模一樣的內容」
    sent_at       timestamptz not null default now()
);
create index if not exists club_dues_log_club_time on public.club_dues_log (club_name, sent_at desc);
alter table public.club_dues_log enable row level security;
revoke all on public.club_dues_log from anon, authenticated;
