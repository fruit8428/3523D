-- =====================================================================
-- 上海商銀入帳通知自動對帳：資料表、權限、每 10 分鐘排程
-- 在 Supabase Dashboard → SQL Editor 貼上整段執行一次即可（可重複執行）
-- =====================================================================

-- 1. 銀行入帳交易（由雲端小程式解析通知信後寫入；前端可讀、可更新配對結果）
create table if not exists public.bank_transactions (
  id             bigserial primary key,
  mail_uid       text unique,          -- 信件唯一識別，避免同一封重複匯入
  mail_date      timestamptz,          -- 信件時間
  tx_time        text,                 -- 入帳交易日期原文，例如 115/08/27 11:01:27
  tx_date        date,                 -- 轉成西元日期
  amount         numeric,              -- 入帳金額
  note           text,                 -- 存摺備註
  account_masked text,                 -- 入帳帳號（遮罩）
  raw_text       text,                 -- 信件純文字（除錯用）
  matched_key    text,                 -- 已配對的繳費表 key（大類id::子活動名稱）
  matched_club   text,                 -- 已配對的社名
  matched_at     timestamptz,
  created_at     timestamptz not null default now()
);
alter table public.bank_transactions enable row level security;
drop policy if exists "anon read bank_transactions"   on public.bank_transactions;
drop policy if exists "anon update bank_transactions" on public.bank_transactions;
create policy "anon read bank_transactions"   on public.bank_transactions for select to anon using (true);
create policy "anon update bank_transactions" on public.bank_transactions for update to anon using (true) with check (true);
-- 新增與刪除只有雲端小程式（service role）能做，前端不能偽造入帳

-- 2. 信箱設定：前端只能「寫入」，不能「讀取」，所以信箱密碼不會外洩
create table if not exists public.bank_mail_settings (
  id            int primary key default 1 check (id = 1),
  email         text,
  app_password  text,
  imap_host     text not null default 'imap.gmail.com',
  imap_port     int  not null default 993,
  sender_filter text not null default 'scsb',   -- 寄件者或主旨包含此字樣才視為銀行通知
  updated_at    timestamptz not null default now()
);
alter table public.bank_mail_settings enable row level security;
drop policy if exists "anon insert bank_mail_settings" on public.bank_mail_settings;
drop policy if exists "anon update bank_mail_settings" on public.bank_mail_settings;
create policy "anon insert bank_mail_settings" on public.bank_mail_settings for insert to anon with check (true);
create policy "anon update bank_mail_settings" on public.bank_mail_settings for update to anon using (true) with check (true);
-- 刻意不建立 select policy

-- 3. 抓取狀態（前端可讀，用來顯示「上次抓取時間／結果／錯誤」）
create table if not exists public.bank_mail_status (
  id                 int primary key default 1 check (id = 1),
  email_masked       text,
  has_password       boolean not null default false,
  last_fetch_at      timestamptz,
  last_result        text,
  last_error         text,
  total_transactions int not null default 0,
  updated_at         timestamptz not null default now()
);
alter table public.bank_mail_status enable row level security;
drop policy if exists "anon read bank_mail_status" on public.bank_mail_status;
create policy "anon read bank_mail_status" on public.bank_mail_status for select to anon using (true);
insert into public.bank_mail_status (id) values (1) on conflict (id) do nothing;

-- 4. 每 10 分鐘自動呼叫雲端小程式抓一次信（pg_cron + pg_net）
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$
begin
  perform cron.unschedule('fetch-bank-mail-every-10min');
exception when others then null;
end $$;
select cron.schedule(
  'fetch-bank-mail-every-10min',
  '*/10 * * * *',
  $$ select net.http_post(
       url := 'https://ncrvmhfggfczicpyebvn.supabase.co/functions/v1/fetch-bank-mail',
       headers := '{"Content-Type":"application/json"}'::jsonb,
       body := '{"source":"cron"}'::jsonb
     ); $$
);

-- 5. （2026-11-01 新增）上海商銀的入帳明細放在加密 PDF 附件，開啟密碼為戶名的身分證號／統一編號末六碼
--    這欄同樣只有雲端小程式（service role）能讀，前端只能寫入
alter table public.bank_mail_settings add column if not exists pdf_password text;
