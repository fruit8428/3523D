-- ============================================================
-- 活動照片找人・第二步：找照片的工作與比對結果
-- ============================================================
-- 流程：管理者（行事曆後台）或執秘（報名系統）貼上攝影師的 Google 雲端硬碟資料夾連結 → 這裡多一筆「工作」→
--       運算程式（相片專案，在 GitHub 雲端執行，用私密金鑰連進來）接手比對，把結果寫進 photo_matches →
--       管理者／執秘按「發送通知」→ 社友在 LINE 看自己的照片，「不太確定」的由本人按是／不是。
-- 照片本身留在攝影師的 Google 雲端硬碟，這裡只存檔案代號。臉部特徵不存（每次比對時由大頭照重新計算）。
-- 三張表都是 RLS 開啟、不建立 policy、收回 anon 權限＝前端完全讀不到。要先跑過 member_portraits.sql。
-- 可以重複執行。跑完這個檔案後要重跑 member_rename.sql（社友改名時比對結果才會跟著搬）。

-- 一個活動資料夾一筆工作
create table if not exists public.photo_jobs (
    id           uuid primary key default gen_random_uuid(),
    scope        text not null check (scope in ('district', 'club')),   -- district＝地區管理者貼的（比對所有開放的社）；club＝某一社執秘貼的（只比對那一社）
    club_name    text not null default '',                              -- scope=club 時是那一社；district 時是空字串
    title        text not null,                                         -- 活動名稱（顯示給社友看）
    folder_id    text not null,                                         -- Google 雲端硬碟資料夾代號
    status       text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
    progress     jsonb not null default '{}'::jsonb,                    -- 運算程式回報的進度：{"stage":"下載中","done":120,"total":523}
    total_photos int not null default 0,                                -- 資料夾裡的照片張數（比對完才有）
    error        text not null default '',                              -- 失敗原因（給管理者看的白話文字）
    created_by   text not null default '',
    created_at   timestamptz not null default now(),
    started_at   timestamptz,
    finished_at  timestamptz,
    sent_at      timestamptz,                                           -- 第一次按「發送通知」的時間；有值，社友才看得到這個活動的照片
    sent_by      text not null default ''
);
create index if not exists photo_jobs_status on public.photo_jobs (status, created_at);
alter table public.photo_jobs enable row level security;
revoke all on public.photo_jobs from anon, authenticated;

-- 比對結果：一張照片裡找到一個人＝一列
create table if not exists public.photo_matches (
    id         bigserial primary key,
    job_id     uuid not null references public.photo_jobs(id) on delete cascade,
    club_name  text not null,
    person_key text not null,                    -- 姓名|Nick Name
    file_id    text not null,                    -- Google 雲端硬碟的檔案代號
    file_name  text not null default '',
    score      real not null default 0,
    cls        text not null check (cls in ('sure', 'maybe')),          -- 運算程式的判斷：確定／不太確定（寫入後不再改）
    status     text not null default 'auto' check (status in ('auto', 'pending', 'yes', 'no')),
                                                 -- auto＝程式確定；pending＝不太確定、等本人確認；yes／no＝本人按了是／不是
    face       jsonb not null default '{}'::jsonb,                      -- 那張臉在照片裡的位置（佔整張圖的比例 0～1）：{"x":0.42,"y":0.18,"w":0.06,"h":0.09}
    decided_at timestamptz,
    unique (job_id, club_name, person_key, file_id)
);
create index if not exists photo_matches_person on public.photo_matches (club_name, person_key);
create index if not exists photo_matches_job on public.photo_matches (job_id);
alter table public.photo_matches enable row level security;
revoke all on public.photo_matches from anon, authenticated;
revoke all on sequence public.photo_matches_id_seq from anon, authenticated;

-- 已經用 LINE 通知過誰（同一個活動不重複通知同一個人）。person_key 是「收到訊息的人」
create table if not exists public.photo_notified (
    job_id     uuid not null references public.photo_jobs(id) on delete cascade,
    club_name  text not null,
    person_key text not null,
    sent_at    timestamptz not null default now(),
    primary key (job_id, club_name, person_key)
);
alter table public.photo_notified enable row level security;
revoke all on public.photo_notified from anon, authenticated;

-- 比對結果保留一年（使用者決定）：每天清一次超過一年的工作，結果與通知紀錄會跟著刪掉。照片本身在攝影師的雲端硬碟，不受影響
do $$
begin
    if exists (select 1 from pg_extension where extname = 'pg_cron') then
        perform cron.unschedule(jobid) from cron.job where jobname = 'photo-jobs-cleanup';
        perform cron.schedule('photo-jobs-cleanup', '23 19 * * *', $c$delete from public.photo_jobs where created_at < now() - interval '1 year'$c$);
    end if;
end $$;
