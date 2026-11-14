-- ============================================================================
-- LINE 自助報到（第二階段）：LINE 帳號與社友的綁定
-- 先執行過 event_checkins.sql 才能執行這一份。在 Supabase SQL Editor 整段貼上執行即可，可重複執行。
--
-- line_bindings   一個 LINE 帳號綁定一位社友（社名＋姓名|Nick Name）；一位社友也只能被一個 LINE 帳號綁定。
--                 LINE 的使用者代碼屬於個資，比照旅平險資料：RLS 開啟、不建立 policy、前端完全讀不到。
--                 只有雲端小程式 line-checkin（用 service_role）可以讀寫，它會先向 LINE 驗證身分。
-- line_checkin_mark  雲端小程式用的報到函式（method = 'line'），前端不能直接呼叫。
-- ============================================================================
create table if not exists public.line_bindings (
    line_user_id text primary key,                 -- LINE 的使用者代碼（同一個 Provider 底下固定）
    club_name    text not null,
    person_key   text not null,                    -- 姓名|Nick Name（與報到紀錄認人的方式相同）
    full_name    text not null,
    nickname     text not null default '',
    display_name text,                             -- 綁定當時的 LINE 顯示名稱（給執秘辨認是誰綁的）
    bound_at     timestamptz not null default now(),
    unique (club_name, person_key)
);
alter table public.line_bindings enable row level security;     -- 不建立 policy＝前端無法直接讀寫
revoke all on public.line_bindings from anon, authenticated;

-- LINE 自助報到。規則與櫃台的 checkin_mark 相同：重複報到不會多一筆、不會改掉第一次的時間；
-- 原本是「現場加報但尚未到場」的人改成已到並保留加報標記。活動必須在「報到中」。
create or replace function public.line_checkin_mark(
    p_event_key text, p_club text, p_person_key text, p_full_name text, p_nickname text, p_by text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.event_checkins%rowtype;
begin
    if not coalesce((select is_open from public.checkin_events where event_key = p_event_key), false) then raise exception 'CHECKIN_CLOSED'; end if;
    if coalesce(p_club, '') = '' or coalesce(p_person_key, '') = '' or coalesce(p_full_name, '') = '' then raise exception 'CHECKIN_MISSING_PERSON'; end if;
    insert into public.event_checkins (event_key, club_name, person_key, full_name, nickname, is_walk_in, method, checked_by)
    values (p_event_key, p_club, p_person_key, p_full_name, coalesce(p_nickname, ''), false, 'line', nullif(p_by, ''))
    on conflict (event_key, club_name, person_key) do update
       set checked_in_at = case when event_checkins.status <> 'in' then now() else event_checkins.checked_in_at end,
           checked_by    = case when event_checkins.status <> 'in' then excluded.checked_by else event_checkins.checked_by end,
           method        = case when event_checkins.status <> 'in' then 'line' else event_checkins.method end,
           is_walk_in    = case when event_checkins.status = 'cancelled' then false else event_checkins.is_walk_in end,
           note          = case when event_checkins.status = 'cancelled' then null else event_checkins.note end,
           status        = 'in',
           updated_at    = now()
    returning * into r;
    return to_jsonb(r);
end $$;
revoke all on function public.line_checkin_mark(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.line_checkin_mark(text, text, text, text, text, text) to service_role;
notify pgrst, 'reload schema';
