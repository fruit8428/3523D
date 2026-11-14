-- ============================================================================
-- LINE 推播紀錄（活動主委對報名社友發送 LINE 提醒）
-- 先執行過 event_checkins.sql、line_bindings.sql。在 Supabase SQL Editor 整段貼上執行即可，可重複執行。
--
-- line_push_log  每發送一次記一筆（哪個活動、誰發的、內容、對象人數、成功與失敗則數），
--                方便事後查帳與對照 LINE 官方帳號的訊息用量。前端讀不到，只有雲端小程式可以讀寫。
-- ============================================================================
create table if not exists public.line_push_log (
    id            bigserial primary key,
    event_key     text not null,                    -- 大類id::子活動名稱
    sent_at       timestamptz not null default now(),
    sender        text,                             -- 操作的社（畫面上登入的社名，僅供參考）
    filter        jsonb not null default '{}'::jsonb, -- 當時選的對象條件
    message       text not null,
    target_count  integer not null default 0,       -- 符合條件的報名人數
    sent_count    integer not null default 0,       -- 已送出則數
    failed_count  integer not null default 0,       -- 送出失敗則數
    unbound_count integer not null default 0        -- 符合條件但沒有綁定 LINE（收不到）的人數
);
create index if not exists line_push_log_event_idx on public.line_push_log (event_key, sent_at desc);
alter table public.line_push_log enable row level security;     -- 不建立 policy＝前端無法直接讀寫
revoke all on public.line_push_log from anon, authenticated;
notify pgrst, 'reload schema';
