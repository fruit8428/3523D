-- =====================================================================
-- 信箱設定改用「儲存函式」寫入（2026-11-01）
-- 原因：bank_mail_settings 刻意不開放前端讀取（保護密碼），但 PostgreSQL 的
-- upsert（有就更新、沒有就新增）需要能讀到舊列才能運作，所以前端直接 upsert 會被
-- 安全規則擋下。改成一個 SECURITY DEFINER 函式：前端只能呼叫它寫入，仍讀不到密碼。
-- 在 Supabase SQL Editor 貼上整段執行一次即可（可重複執行）
-- =====================================================================

-- 1. 收回前端對設定表的直接寫入權（之後只能透過函式）
drop policy if exists "anon insert bank_mail_settings" on public.bank_mail_settings;
drop policy if exists "anon update bank_mail_settings" on public.bank_mail_settings;

-- 2. 儲存函式：密碼欄位傳空字串＝不變更
create or replace function public.set_bank_mail_settings(
  p_email        text,
  p_password     text default '',
  p_imap_host    text default 'imap.gmail.com',
  p_imap_port    int  default 993,
  p_pdf_password text default ''
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.bank_mail_settings (id, email, app_password, imap_host, imap_port, pdf_password, updated_at)
  values (1, p_email, nullif(p_password, ''), coalesce(nullif(p_imap_host, ''), 'imap.gmail.com'), coalesce(p_imap_port, 993), nullif(p_pdf_password, ''), now())
  on conflict (id) do update set
    email        = excluded.email,
    app_password = coalesce(excluded.app_password, public.bank_mail_settings.app_password),
    imap_host    = excluded.imap_host,
    imap_port    = excluded.imap_port,
    pdf_password = coalesce(excluded.pdf_password, public.bank_mail_settings.pdf_password),
    updated_at   = now();
end;
$$;
revoke all on function public.set_bank_mail_settings(text, text, text, int, text) from public;
grant execute on function public.set_bank_mail_settings(text, text, text, int, text) to anon, authenticated;
