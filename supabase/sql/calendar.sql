-- ============================================================================
-- 扶輪行事曆（階段 1）：行程、活動類型、行事曆管理者
-- 在 Supabase SQL Editor 整段貼上執行即可，可重複執行。
--
-- 三張表都開啟 RLS 而且「不建立 policy」＝前端（anon）完全讀不到也寫不到。
-- 全部透過雲端小程式 line-checkin（service_role）存取；小程式會先向 LINE 驗證身分，
-- 再依 calendar_roles 檢查權限。私人行程因此不會被別人用 anon key 偷看。
--
-- 認人方式與 LINE 報到相同：社名（club_name）＋「姓名|Nick Name」（person_key），不用社友 id。
-- ============================================================================

-- 活動類型（後台可改名、新增）
create table if not exists public.calendar_event_types (
    id         serial primary key,
    name       text not null unique,
    sort_order int  not null default 0
);
insert into public.calendar_event_types (name, sort_order) values
    ('公式訪問', 10), ('授證典禮', 20), ('理事會', 30), ('例會', 40), ('地區活動', 50),
    ('社區服務', 60), ('國際活動', 70), ('聯誼活動', 80), ('私人行程', 90), ('其他', 100)
on conflict (name) do nothing;

-- 行事曆管理者：由最高管理員在後台指定，不依職稱自動給予
--   district_editor：可新增／修改／刪除地區行程
--   club_editor    ：可管理「managed_club」這一社的社內行程（通常是自己的社）
--   governor       ：總監（階段 4 的每日推播用，階段 1 只記錄）
create table if not exists public.calendar_roles (
    id           bigserial primary key,
    club_name    text not null,                 -- 這位社友所屬的社
    person_key   text not null,                 -- 姓名|Nick Name
    full_name    text not null,
    nickname     text not null default '',
    role         text not null check (role in ('district_editor', 'club_editor', 'governor')),
    managed_club text not null default '',      -- club_editor 時＝可管理的社；其他角色為空字串
    granted_at   timestamptz not null default now(),
    unique (club_name, person_key, role, managed_club)
);

-- 行程主表
create table if not exists public.calendar_events (
    id              uuid primary key default gen_random_uuid(),
    layer           text not null check (layer in ('district', 'club', 'private')),
    club_name       text not null default '',   -- club＝該社；private＝擁有者所屬社；district＝空字串
    owner_key       text not null default '',   -- private＝擁有者的 person_key；其他為空字串
    title           text not null,
    start_at        timestamptz not null,
    end_at          timestamptz not null,       -- 沒填結束時間時等於開始時間；全天行程為當天 23:59
    all_day         boolean not null default false,
    event_type_id   int references public.calendar_event_types(id) on delete set null,
    location        text not null default '',
    address         text not null default '',
    dress_code      text not null default '',
    contact_person  text not null default '',
    contact_phone   text not null default '',
    notes           text not null default '',
    status          text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
    registration_key text,                      -- 階段 3：對應報名系統的「大類id::子活動名稱」
    created_by      text not null default '',   -- 姓名（社名）
    updated_by      text not null default '',
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    check (end_at >= start_at)
);
create index if not exists calendar_events_layer_time on public.calendar_events (layer, end_at, start_at);
create index if not exists calendar_events_club on public.calendar_events (club_name);

-- 手機行事曆訂閱（.ics）：每位社友一組專屬網址（token）。enabled=false 時網址立即失效。
-- token 等同密碼（知道網址就看得到該社友的所有行程，含私人），所以這張表比照 line_bindings：anon 完全讀不到。
create table if not exists public.calendar_ics (
    club_name  text not null,
    person_key text not null,
    token      text not null unique,
    enabled    boolean not null default true,
    created_at timestamptz not null default now(),
    rotated_at timestamptz,
    primary key (club_name, person_key)
);

-- 社友在 LINE 按「我要參加」留下的「參加意願」。不是正式報名：執秘在報名系統確認後才轉成正式報名。
-- 一個行程、一個社、一個人只有一筆；行程刪除時一併刪除。anon 讀不到。
create table if not exists public.calendar_rsvp (
    event_id   uuid not null references public.calendar_events(id) on delete cascade,
    club_name  text not null,
    person_key text not null,             -- 姓名|Nick Name
    full_name  text not null,
    nickname   text not null default '',
    created_at timestamptz not null default now(),
    primary key (event_id, club_name, person_key)
);

-- 後來新增的欄位（舊資料表用 alter 補上，可重複執行）
--   calendar_events.rsvp_enabled：開放社友按「我要參加」（社內例會等不需要走報名系統的活動；有對應報名活動的行程也可以開）
--   calendar_rsvp.guest_of：這一筆是某位社友帶來的寶尊眷時，填那位社友的 person_key；本人自己的那筆為空字串
--   calendar_rsvp.guest_role：寶尊眷的稱謂（社友庫裡的職務，例如「寶(尊)眷」）
alter table public.calendar_events add column if not exists rsvp_enabled boolean not null default false;
alter table public.calendar_rsvp   add column if not exists guest_of   text not null default '';
alter table public.calendar_rsvp   add column if not exists guest_role text not null default '';

-- 社內例會的「實際出席」紀錄：由執秘在報名系統的「行事曆管理」勾選後儲存（不是社友自己按的「表示參加」）。
-- 一個行程、一個社、一個人一筆；重新儲存時整批取代。行程刪除時一併刪除。anon 讀不到。
create table if not exists public.calendar_attendance (
    event_id   uuid not null references public.calendar_events(id) on delete cascade,
    club_name  text not null,
    person_key text not null,             -- 姓名|Nick Name
    full_name  text not null,
    nickname   text not null default '',
    role       text not null default '',  -- 社友庫的職務（寶尊眷為「寶(尊)眷」）
    is_guest   boolean not null default false,   -- 寶尊眷
    marked_by  text not null default '',
    marked_at  timestamptz not null default now(),
    primary key (event_id, club_name, person_key)
);
alter table public.calendar_attendance  enable row level security;

alter table public.calendar_rsvp        enable row level security;
alter table public.calendar_ics         enable row level security;
alter table public.calendar_event_types enable row level security;
alter table public.calendar_roles       enable row level security;
alter table public.calendar_events      enable row level security;
revoke all on public.calendar_event_types, public.calendar_roles, public.calendar_events, public.calendar_ics, public.calendar_rsvp, public.calendar_attendance from anon, authenticated;
revoke all on sequence public.calendar_event_types_id_seq, public.calendar_roles_id_seq from anon, authenticated;
notify pgrst, 'reload schema';
