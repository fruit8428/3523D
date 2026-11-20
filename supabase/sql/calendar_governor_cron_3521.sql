-- ============================================================================
-- 總監每日推播的排程（3521）：每天台灣時間晚上 8:00（UTC 12:00）呼叫雲端小程式 line-checkin，
-- 把總監「明天」的行程用 LINE 推給總監與總監秘書。明天沒有行程就不推。
-- 要先執行過 calendar.sql（會建立 calendar_settings 並自動產生排程密碼 cron_secret）。
-- 這份可以重複執行（會先移除舊的排程再建立）。要停止推播：執行最下面註解掉的 unschedule。
-- 這份是 3521 版（由 calendar_governor_cron.sql 改 url 與 liffId 而來）。
-- ============================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$
begin
  perform cron.unschedule('calendar-governor-digest');
exception when others then null;
end $$;
select cron.schedule(
  'calendar-governor-digest',
  '0 12 * * *',
  $$ select net.http_post(
       url := 'https://dkzpznvhqzvpeiajyyab.supabase.co/functions/v1/line-checkin',
       headers := '{"Content-Type":"application/json"}'::jsonb,
       timeout_milliseconds := 120000,   -- 最多等 2 分鐘（預設只等 5 秒；小程式剛啟動或一次要發很多人時會超過）
       body := jsonb_build_object(
         'action', 'cal_cron_digest',
         'liffId', '2012609430-gMTTWlNe',
         'secret', (select value from public.calendar_settings where key = 'cron_secret')
       )
     ); $$
);
-- 停止推播：
-- select cron.unschedule('calendar-governor-digest');
