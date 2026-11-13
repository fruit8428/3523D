-- ============================================================================
-- 旅平險個資保存空間（社長當選人研討會 PELS 等需要投保的活動）
-- 在 Supabase SQL Editor 整段貼上執行一次即可，可重複執行。
--
-- 為什麼要另外一張表：
--   報名系統的主要資料（app_storage）是「任何拿到網頁的人都讀得到」的公開資料，
--   身分證字號、生日、手機不能放在那裡。這張表完全不開放前端直接讀寫，只能透過下面的函式：
--     save_insured_persons   執秘送出報名表時寫入（只能寫、不能讀）
--     read_insured_persons   主委匯出保險名單時讀取，必須輸入「個資檢視密碼」
--     delete_insured_persons 活動結束後刪除個資，必須輸入「個資檢視密碼」
--     set_pii_view_password  設定／變更個資檢視密碼（第一次設定不需舊密碼）
--   個資檢視密碼只存雜湊值在資料庫裡，不會出現在網頁程式中。
-- ============================================================================
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.insured_persons (
    id            bigserial primary key,
    event_key     text not null,              -- 大類id::子活動名稱
    club_name     text not null,
    member_key    text not null,              -- 報名社友（姓名|Nick Name）
    person_role   text not null default 'self' check (person_role in ('self', 'family')),
    full_name     text not null,
    id_no         text not null,              -- 身分證字號
    birth_roc     text not null,              -- 民國出生年月日，例：065/03/09
    phone         text not null,
    attend_option text,
    updated_at    timestamptz not null default now(),
    unique (event_key, club_name, member_key, person_role)
);
alter table public.insured_persons enable row level security;   -- 不建立任何 policy＝前端無法直接讀寫
revoke all on public.insured_persons from anon, authenticated;

create table if not exists public.app_secrets (
    name       text primary key,
    value_hash text not null,
    updated_at timestamptz not null default now()
);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;

-- 內部用：檢查個資檢視密碼（錯誤時故意等 1 秒，降低被猜密碼的速度）
create or replace function public._pii_password_ok(p_password text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare h text;
begin
    select value_hash into h from public.app_secrets where name = 'pii_view_password';
    if h is null then raise exception 'PII_PASSWORD_NOT_SET'; end if;
    if p_password is null or crypt(p_password, h) <> h then
        perform pg_sleep(1);
        return false;
    end if;
    return true;
end $$;
revoke all on function public._pii_password_ok(text) from public, anon, authenticated;

create or replace function public.pii_password_is_set() returns boolean
language sql security definer set search_path = public as $$
    select exists (select 1 from public.app_secrets where name = 'pii_view_password');
$$;

create or replace function public.set_pii_view_password(p_old text, p_new text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
    if p_new is null or length(p_new) < 8 then raise exception 'PII_PASSWORD_TOO_SHORT'; end if;
    if exists (select 1 from public.app_secrets where name = 'pii_view_password') then
        if not public._pii_password_ok(p_old) then raise exception 'PII_PASSWORD_WRONG'; end if;
    end if;
    insert into public.app_secrets (name, value_hash) values ('pii_view_password', crypt(p_new, gen_salt('bf')))
    on conflict (name) do update set value_hash = excluded.value_hash, updated_at = now();
    return true;
end $$;

-- 執秘送出：p_rows＝要新增／更新的人；p_keep＝這個社在這個活動應保留的「member_key|person_role」清單，
-- 不在清單內的舊資料會刪掉（例如取消報名、改成不克參加、不再攜眷）
create or replace function public.save_insured_persons(p_event_key text, p_club text, p_rows jsonb, p_keep jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare r jsonb; n integer := 0;
begin
    if coalesce(p_event_key, '') = '' or coalesce(p_club, '') = '' then raise exception 'MISSING_KEY'; end if;
    delete from public.insured_persons
     where event_key = p_event_key and club_name = p_club
       and not (coalesce(p_keep, '[]'::jsonb) ? (member_key || '|' || person_role));
    for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
        insert into public.insured_persons (event_key, club_name, member_key, person_role, full_name, id_no, birth_roc, phone, attend_option)
        values (p_event_key, p_club, r->>'member_key', coalesce(r->>'person_role', 'self'), r->>'full_name', upper(r->>'id_no'), r->>'birth_roc', r->>'phone', r->>'attend_option')
        on conflict (event_key, club_name, member_key, person_role) do update
           set full_name = excluded.full_name, id_no = excluded.id_no, birth_roc = excluded.birth_roc,
               phone = excluded.phone, attend_option = excluded.attend_option, updated_at = now();
        n := n + 1;
    end loop;
    return n;
end $$;

create or replace function public.read_insured_persons(p_event_key text, p_password text)
returns table (club_name text, member_key text, person_role text, full_name text, id_no text, birth_roc text, phone text, attend_option text, updated_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
    if not public._pii_password_ok(p_password) then raise exception 'PII_PASSWORD_WRONG'; end if;
    return query select i.club_name, i.member_key, i.person_role, i.full_name, i.id_no, i.birth_roc, i.phone, i.attend_option, i.updated_at
                   from public.insured_persons i where i.event_key = p_event_key order by i.club_name, i.member_key, i.person_role desc;
end $$;

create or replace function public.delete_insured_persons(p_event_key text, p_password text) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
    if not public._pii_password_ok(p_password) then raise exception 'PII_PASSWORD_WRONG'; end if;
    delete from public.insured_persons where event_key = p_event_key;
    get diagnostics n = row_count;
    return n;
end $$;

grant execute on function public.pii_password_is_set() to anon, authenticated;
grant execute on function public.set_pii_view_password(text, text) to anon, authenticated;
grant execute on function public.save_insured_persons(text, text, jsonb, jsonb) to anon, authenticated;
grant execute on function public.read_insured_persons(text, text) to anon, authenticated;
grant execute on function public.delete_insured_persons(text, text) to anon, authenticated;
notify pgrst, 'reload schema';
