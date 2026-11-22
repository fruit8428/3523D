-- ============================================================
-- 活動照片找人・第一步：社友大頭照
-- ============================================================
-- 大頭照是敏感個資（之後要拿來做人臉比對），不可以放進 app_storage，也不可以放進公開的儲存空間。
--   - 兩張表 RLS 開啟、不建立 policy、收回 anon 權限＝前端完全讀不到，只有雲端小程式 line-checkin 能讀寫。
--   - 檔案放在「不公開」的儲存空間 member-portraits（沒有任何 storage policy＝前端讀不到），
--     要顯示時由雲端小程式產生有期限的簽名網址。檔名是亂數，不含姓名。
--   - 認人用「社名＋姓名|Nick Name」（社友沒有固定編號）。社友改名時由 member_rename_move 一起搬（要重跑 member_rename.sql）。
-- 可以重複執行。

-- 哪些社可以用（沒有那一列＝關閉；預設全部關閉）。由行事曆後台「⑦ 活動照片找人」逐社開放
create table if not exists public.photo_club_enabled (
    club_name  text primary key,
    updated_at timestamptz not null default now()
);
alter table public.photo_club_enabled enable row level security;
revoke all on public.photo_club_enabled from anon, authenticated;

-- 一張大頭照一列（每人最多 3 張，由雲端小程式把關）。這個人沒有任何一列＝沒有同意、不比對
create table if not exists public.member_portraits (
    id         uuid primary key default gen_random_uuid(),
    club_name  text not null,
    person_key text not null,                    -- 姓名|Nick Name
    path       text not null unique,             -- 儲存空間裡的檔名（亂數）
    consent_by text not null default 'self',     -- self＝本人在 LINE 上傳並按同意；其他＝代傳的人（例如「報名系統（某某社）」）
    consent_at timestamptz not null default now(),
    created_at timestamptz not null default now()
);
create index if not exists member_portraits_person on public.member_portraits (club_name, person_key);
alter table public.member_portraits enable row level security;
revoke all on public.member_portraits from anon, authenticated;

-- 不公開的儲存空間：單檔上限 2MB、只收 JPEG（上傳前畫面會先縮圖並轉成 JPEG）
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('member-portraits', 'member-portraits', false, 2097152, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg'];
