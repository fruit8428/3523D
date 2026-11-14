-- ============================================================================
-- 活動報到系統（櫃台點名）
-- 在 Supabase SQL Editor 整段貼上執行一次即可，可重複執行。
--
-- 為什麼要另外開資料表：
--   報名資料（app_storage）是「整包覆寫」，活動當天多個櫃台同時點名會互相蓋掉。
--   報到改成「每報到一個人寫一筆」，彼此不會覆蓋。
--
-- 兩張表：
--   checkin_events   每個活動的報到設定（是否開放報到、報到密碼的雜湊值）。前端不能直接讀寫。
--   event_checkins   報到紀錄，一人一筆。前端可以讀（姓名與社名本來就是公開的報名資料），
--                    但不能直接寫，只能透過下面的函式，而且要帶「報到密碼」、活動要在「報到中」。
--
-- 函式：
--   checkin_event_status  查詢某活動的報到狀態（是否開放、是否已設密碼）
--   checkin_set_event     主委：開始／結束報到、設定報到密碼
--   checkin_verify        工作人員進入報到頁時檢查密碼
--   checkin_mark          報到（重複點同一個人不會產生第二筆）
--   checkin_add_walkin    現場加報但人還沒到（例：社友先幫忙報名）：先加入名單，狀態為 pending，人到了再按報到
--   checkin_cancel        取消誤點的報到（紀錄保留、狀態改為已取消；現場加報的人則變回「尚未到場」，仍留在名單上）
--   checkin_remove_walkin 把現場加報的人從名單刪除（狀態改為已取消）
--   checkin_reset         清空某活動全部報到紀錄（活動前測試完要歸零時用）
--
-- 安全性說明：這個系統沒有真正的帳號登入，checkin_set_event 無法驗證呼叫者是不是主委，
-- 所以報到密碼只能擋住一般人誤入，擋不住懂技術又刻意搗亂的人（與整個報名系統的防護程度相同）。
-- ============================================================================
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.checkin_events (
    event_key     text primary key,                 -- 大類id::子活動名稱
    is_open       boolean not null default false,   -- true＝報到中
    password_hash text,                             -- 報到密碼（bcrypt 雜湊，不存明碼）
    opened_at     timestamptz,
    closed_at     timestamptz,
    updated_at    timestamptz not null default now()
);
alter table public.checkin_events enable row level security;    -- 不建立 policy＝前端無法直接讀寫
revoke all on public.checkin_events from anon, authenticated;

create table if not exists public.event_checkins (
    id            bigserial primary key,
    event_key     text not null,                    -- 大類id::子活動名稱
    club_name     text not null,
    person_key    text not null,                    -- 姓名|Nick Name（與報名資料認人的方式相同）
    full_name     text not null,
    nickname      text not null default '',
    is_walk_in    boolean not null default false,   -- true＝現場加報（不在報名名單內）
    note          text,                             -- 現場加報的備註，例：代理某某出席、來賓
    status        text not null default 'in',       -- in＝已報到；cancelled＝已取消；pending＝現場加報但尚未到場
    method        text not null default 'desk',     -- desk＝櫃台點名；line＝LINE 自助報到（第二階段）
    checked_by    text,                             -- 操作的櫃台／工作人員名稱
    checked_in_at timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    unique (event_key, club_name, person_key)
);
create index if not exists event_checkins_event_updated_idx on public.event_checkins (event_key, updated_at);
-- status 多一種 pending＝現場加報但尚未到場（2026-11-14 新增；舊資料庫重跑這份 SQL 會自動更新限制條件）
alter table public.event_checkins drop constraint if exists event_checkins_status_check;
alter table public.event_checkins add constraint event_checkins_status_check check (status in ('in', 'cancelled', 'pending'));
alter table public.event_checkins enable row level security;
revoke all on public.event_checkins from anon, authenticated;
grant select on public.event_checkins to anon, authenticated;   -- 只開放讀取，寫入一律走函式
drop policy if exists "checkins readable" on public.event_checkins;
create policy "checkins readable" on public.event_checkins for select to anon, authenticated using (true);

-- 內部用：回傳活動狀態（不含密碼雜湊）
create or replace function public._checkin_status_json(p_event_key text) returns jsonb
language sql security definer set search_path = public as $$
    select coalesce(
        (select jsonb_build_object('event_key', e.event_key, 'is_open', e.is_open, 'has_password', e.password_hash is not null,
                                   'opened_at', e.opened_at, 'closed_at', e.closed_at)
           from public.checkin_events e where e.event_key = p_event_key),
        jsonb_build_object('event_key', p_event_key, 'is_open', false, 'has_password', false, 'opened_at', null, 'closed_at', null));
$$;
revoke all on function public._checkin_status_json(text) from public, anon, authenticated;

-- 內部用：檢查報到密碼（錯誤時故意等 1 秒，降低被猜密碼的速度）
create or replace function public._checkin_password_ok(p_event_key text, p_password text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare h text;
begin
    select password_hash into h from public.checkin_events where event_key = p_event_key;
    if h is null then raise exception 'CHECKIN_PASSWORD_NOT_SET'; end if;
    if p_password is null or crypt(p_password, h) <> h then
        perform pg_sleep(1);
        return false;
    end if;
    return true;
end $$;
revoke all on function public._checkin_password_ok(text, text) from public, anon, authenticated;

create or replace function public.checkin_event_status(p_event_key text) returns jsonb
language sql security definer set search_path = public as $$
    select public._checkin_status_json(p_event_key);
$$;

-- 主委：開始／結束報到、設定密碼。p_is_open 或 p_new_password 傳 null 表示該項不變。
create or replace function public.checkin_set_event(p_event_key text, p_is_open boolean, p_new_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare cur public.checkin_events%rowtype;
begin
    if coalesce(p_event_key, '') = '' then raise exception 'CHECKIN_MISSING_KEY'; end if;
    if p_new_password is not null and length(p_new_password) < 4 then raise exception 'CHECKIN_PASSWORD_TOO_SHORT'; end if;
    insert into public.checkin_events (event_key) values (p_event_key) on conflict (event_key) do nothing;
    if p_new_password is not null then
        update public.checkin_events set password_hash = crypt(p_new_password, gen_salt('bf', 8)), updated_at = now()
         where event_key = p_event_key;
    end if;
    select * into cur from public.checkin_events where event_key = p_event_key;
    if p_is_open is not null and p_is_open <> cur.is_open then
        if p_is_open and cur.password_hash is null then raise exception 'CHECKIN_PASSWORD_NOT_SET'; end if;
        update public.checkin_events
           set is_open = p_is_open,
               opened_at = case when p_is_open then now() else opened_at end,
               closed_at = case when p_is_open then null else now() end,
               updated_at = now()
         where event_key = p_event_key;
    end if;
    return public._checkin_status_json(p_event_key);
end $$;

-- 工作人員進入報到頁：密碼正確回傳活動狀態，錯誤則丟出 CHECKIN_PASSWORD_WRONG
create or replace function public.checkin_verify(p_event_key text, p_password text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
    if not public._checkin_password_ok(p_event_key, p_password) then raise exception 'CHECKIN_PASSWORD_WRONG'; end if;
    return public._checkin_status_json(p_event_key);
end $$;

-- 報到。同一個人重複點不會產生第二筆，也不會改掉第一次的報到時間；被取消後再點則視為重新報到。
-- 原本是「現場加報但尚未到場」（pending）的人：改成已到，保留現場加報的標記與備註。
create or replace function public.checkin_mark(
    p_event_key text, p_password text, p_club text, p_person_key text,
    p_full_name text, p_nickname text, p_is_walk_in boolean, p_note text, p_by text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.event_checkins%rowtype;
begin
    if not public._checkin_password_ok(p_event_key, p_password) then raise exception 'CHECKIN_PASSWORD_WRONG'; end if;
    if not coalesce((select is_open from public.checkin_events where event_key = p_event_key), false) then raise exception 'CHECKIN_CLOSED'; end if;
    if coalesce(p_club, '') = '' or coalesce(p_person_key, '') = '' or coalesce(p_full_name, '') = '' then raise exception 'CHECKIN_MISSING_PERSON'; end if;
    insert into public.event_checkins (event_key, club_name, person_key, full_name, nickname, is_walk_in, note, checked_by)
    values (p_event_key, p_club, p_person_key, p_full_name, coalesce(p_nickname, ''), coalesce(p_is_walk_in, false), nullif(p_note, ''), nullif(p_by, ''))
    on conflict (event_key, club_name, person_key) do update
       set checked_in_at = case when event_checkins.status <> 'in' then now() else event_checkins.checked_in_at end,
           checked_by    = case when event_checkins.status <> 'in' then excluded.checked_by else event_checkins.checked_by end,
           is_walk_in    = case when event_checkins.status = 'cancelled' then excluded.is_walk_in else event_checkins.is_walk_in end,
           note          = case when event_checkins.status = 'cancelled' then excluded.note else event_checkins.note end,
           status        = 'in',
           updated_at    = now()
    returning * into r;
    return to_jsonb(r);
end $$;

-- 現場加報但人還沒到：先加入名單（status = pending），人到了再用 checkin_mark 報到。
-- 已經報到（in）或已在加報名單（pending）的人不會被改動；之前被取消的人則重新加入。
create or replace function public.checkin_add_walkin(
    p_event_key text, p_password text, p_club text, p_person_key text,
    p_full_name text, p_nickname text, p_note text, p_by text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.event_checkins%rowtype;
begin
    if not public._checkin_password_ok(p_event_key, p_password) then raise exception 'CHECKIN_PASSWORD_WRONG'; end if;
    if not coalesce((select is_open from public.checkin_events where event_key = p_event_key), false) then raise exception 'CHECKIN_CLOSED'; end if;
    if coalesce(p_club, '') = '' or coalesce(p_person_key, '') = '' or coalesce(p_full_name, '') = '' then raise exception 'CHECKIN_MISSING_PERSON'; end if;
    insert into public.event_checkins (event_key, club_name, person_key, full_name, nickname, is_walk_in, note, status, checked_by)
    values (p_event_key, p_club, p_person_key, p_full_name, coalesce(p_nickname, ''), true, nullif(p_note, ''), 'pending', nullif(p_by, ''))
    on conflict (event_key, club_name, person_key) do update
       set is_walk_in = case when event_checkins.status = 'cancelled' then true else event_checkins.is_walk_in end,
           note       = case when event_checkins.status = 'cancelled' then excluded.note else event_checkins.note end,
           checked_by = case when event_checkins.status = 'cancelled' then excluded.checked_by else event_checkins.checked_by end,
           status     = case when event_checkins.status = 'cancelled' then 'pending' else event_checkins.status end,
           updated_at = now()
    returning * into r;
    return to_jsonb(r);
end $$;

-- 取消報到（誤點）。紀錄不刪除，只把狀態改成已取消，其他櫃台才同步得到這個變更。
-- 現場加報的人：取消報到後變回「尚未到場」（pending），名字仍留在名單上；要從名單拿掉請用 checkin_remove_walkin。
create or replace function public.checkin_cancel(p_event_key text, p_password text, p_club text, p_person_key text, p_by text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.event_checkins%rowtype;
begin
    if not public._checkin_password_ok(p_event_key, p_password) then raise exception 'CHECKIN_PASSWORD_WRONG'; end if;
    if not coalesce((select is_open from public.checkin_events where event_key = p_event_key), false) then raise exception 'CHECKIN_CLOSED'; end if;
    update public.event_checkins
       set status = case when status = 'pending' then 'pending' when is_walk_in then 'pending' else 'cancelled' end,
           checked_by = coalesce(nullif(p_by, ''), checked_by), updated_at = now()
     where event_key = p_event_key and club_name = p_club and person_key = p_person_key
    returning * into r;
    if r.id is null then return null; end if;
    return to_jsonb(r);
end $$;

-- 把現場加報的人從名單刪除（紀錄保留、狀態改為已取消）。只對現場加報的人有效。
create or replace function public.checkin_remove_walkin(p_event_key text, p_password text, p_club text, p_person_key text, p_by text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.event_checkins%rowtype;
begin
    if not public._checkin_password_ok(p_event_key, p_password) then raise exception 'CHECKIN_PASSWORD_WRONG'; end if;
    if not coalesce((select is_open from public.checkin_events where event_key = p_event_key), false) then raise exception 'CHECKIN_CLOSED'; end if;
    update public.event_checkins
       set status = 'cancelled', checked_by = coalesce(nullif(p_by, ''), checked_by), updated_at = now()
     where event_key = p_event_key and club_name = p_club and person_key = p_person_key and (is_walk_in or status = 'pending')
    returning * into r;
    if r.id is null then return null; end if;
    return to_jsonb(r);
end $$;

-- 清空某活動全部報到紀錄（活動前測試完歸零）。報到設定與密碼保留。
create or replace function public.checkin_reset(p_event_key text, p_password text) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
    if not public._checkin_password_ok(p_event_key, p_password) then raise exception 'CHECKIN_PASSWORD_WRONG'; end if;
    delete from public.event_checkins where event_key = p_event_key;
    get diagnostics n = row_count;
    return n;
end $$;

grant execute on function public.checkin_event_status(text) to anon, authenticated;
grant execute on function public.checkin_set_event(text, boolean, text) to anon, authenticated;
grant execute on function public.checkin_verify(text, text) to anon, authenticated;
grant execute on function public.checkin_mark(text, text, text, text, text, text, boolean, text, text) to anon, authenticated;
grant execute on function public.checkin_add_walkin(text, text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.checkin_cancel(text, text, text, text, text) to anon, authenticated;
grant execute on function public.checkin_remove_walkin(text, text, text, text, text) to anon, authenticated;
grant execute on function public.checkin_reset(text, text) to anon, authenticated;
notify pgrst, 'reload schema';
