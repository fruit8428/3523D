-- ============================================================================
-- 各社活動提醒推播（3521）：資料表＋排程。可以重複執行。要先執行過 calendar.sql。
-- 管理者在行事曆後台逐社開放（預設關閉）；開放的社，系統在活動「前一天」的指定整點（預設晚上 8 點）
-- 用 LINE 提醒該社明天有活動、而且已表示參加或已報名的社友。
-- 排程：台灣時間每天 8:00～21:00 每個整點（UTC 0～13 點）呼叫雲端小程式 line-checkin；
--       小程式只處理「已開放、而且設定的時間＝現在這個整點」的社，其他時候什麼都不做。
-- 其他地區使用時，要改 url（Supabase 專案網址）與 liffId（地區設定檔的 lineLiffId）。
-- ============================================================================
-- 哪些社開放活動提醒（沒有這一列＝關閉）
create table if not exists public.calendar_club_push (
    club_name  text primary key,
    enabled    boolean not null default true,
    hour       int not null default 20 check (hour between 8 and 21),   -- 活動前一天的幾點推（台灣時間，整點）
    updated_at timestamptz not null default now()
);
alter table public.calendar_club_push enable row level security;    -- 不建立 policy＝前端讀不到，只有雲端小程式能讀寫
revoke all on public.calendar_club_push from anon, authenticated;

-- 「今天這個活動已經推給誰」：各社活動提醒與活動主委的推播都會寫，用來避免同一天重複提醒同一個活動。
-- event_ref＝對應的報名活動 key（大類id::子活動名稱）；沒有對應報名活動的行程＝cal:<行程 id>。
create table if not exists public.calendar_push_sent (
    sent_day   date not null,               -- 發送當天（台灣日期）
    event_ref  text not null,
    club_name  text not null,
    person_key text not null,               -- 姓名|Nick Name
    source     text not null default '',    -- club＝各社活動提醒；chair＝活動主委推播
    sent_at    timestamptz not null default now(),
    primary key (sent_day, event_ref, club_name, person_key)
);
alter table public.calendar_push_sent enable row level security;
revoke all on public.calendar_push_sent from anon, authenticated;

create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$
begin
  perform cron.unschedule('calendar-club-remind');
exception when others then null;
end $$;
select cron.schedule(
  'calendar-club-remind',
  '0 0-13 * * *',
  $$ select net.http_post(
       url := 'https://dkzpznvhqzvpeiajyyab.supabase.co/functions/v1/line-checkin',
       headers := '{"Content-Type":"application/json"}'::jsonb,
       timeout_milliseconds := 120000,   -- 最多等 2 分鐘（預設只等 5 秒；小程式剛啟動或一次要發很多人時會超過）
       body := jsonb_build_object(
         'action', 'cal_cron_club_remind',
         'liffId', '2012609430-gMTTWlNe',
         'secret', (select value from public.calendar_settings where key = 'cron_secret')
       )
     ); $$
);
-- 停止全部社的活動提醒：
-- select cron.unschedule('calendar-club-remind');
