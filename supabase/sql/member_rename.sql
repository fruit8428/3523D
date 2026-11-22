-- ============================================================
-- 社友改名（姓名或 Nick Name）時，把他名下的紀錄一起搬到新名字
-- ============================================================
-- 為什麼需要：整個系統認人是用「社名＋姓名|Nick Name」。社友每年換職稱（PE→P→PP、DGE→DG）
-- Nick Name 就會變，舊名字底下的 LINE 綁定、行事曆身分、私人行程、出席紀錄都會對不上。
--
-- 這個函式只開放給雲端小程式 line-checkin（service_role）呼叫，前端（anon）不能直接呼叫；
-- 小程式會先確認社的登入密碼、新名字真的在社友庫、舊名字已不在社友庫。
-- 全部在同一筆交易裡完成：中途出錯就整個還原，不會搬一半。
-- 可以重複執行（create or replace）。要先跑過 event_checkins.sql、line_bindings.sql、calendar.sql。

create or replace function public.member_rename_move(
    p_club text, p_old text, p_new text, p_name text, p_nick text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    n int;
    out jsonb := '{}'::jsonb;
    old_name text := split_part(coalesce(p_old, ''), '|', 1);
    gp_old text := 'guest:' || coalesce(p_old, '') || ':';   -- 執秘代登記的同行者（非社友）的 key 前綴
    gp_new text := 'guest:' || coalesce(p_new, '') || ':';
    dk_old text := coalesce(p_club, '') || '|' || coalesce(p_old, '');
    dk_new text := coalesce(p_club, '') || '|' || coalesce(p_new, '');
begin
    if coalesce(p_club, '') = '' or coalesce(p_old, '') = '' or coalesce(p_new, '') = '' or p_old = p_new or coalesce(p_name, '') = '' then
        raise exception 'MEMBER_RENAME_BAD_INPUT';
    end if;
    p_nick := coalesce(p_nick, '');

    -- ---------- LINE 綁定：新舊名字都已經各自綁了 LINE＝兩個不同的人，不能合併 ----------
    if to_regclass('public.line_bindings') is not null then
        if exists (select 1 from line_bindings where club_name = p_club and person_key = p_old)
           and exists (select 1 from line_bindings where club_name = p_club and person_key = p_new) then
            raise exception 'MEMBER_RENAME_CONFLICT';
        end if;
        update line_bindings set person_key = p_new, full_name = p_name, nickname = p_nick
         where club_name = p_club and person_key = p_old;
        get diagnostics n = row_count; out := out || jsonb_build_object('binding', n);
    end if;

    -- ---------- 活動報到紀錄 ----------
    if to_regclass('public.event_checkins') is not null then
        delete from event_checkins o where o.club_name = p_club and o.person_key = p_old
           and exists (select 1 from event_checkins x where x.event_key = o.event_key and x.club_name = p_club and x.person_key = p_new);
        update event_checkins set person_key = p_new, full_name = p_name, nickname = p_nick
         where club_name = p_club and person_key = p_old;
        get diagnostics n = row_count; out := out || jsonb_build_object('checkins', n);
    end if;

    -- ---------- 行事曆 ----------
    if to_regclass('public.calendar_events') is not null then
        -- 身分（管理者、總監、總監秘書）
        delete from calendar_roles o where o.club_name = p_club and o.person_key = p_old
           and exists (select 1 from calendar_roles x where x.club_name = p_club and x.person_key = p_new and x.role = o.role and x.managed_club = o.managed_club);
        update calendar_roles set person_key = p_new, full_name = p_name, nickname = p_nick
         where club_name = p_club and person_key = p_old;
        get diagnostics n = row_count; out := out || jsonb_build_object('roles', n);

        -- 私人行程
        update calendar_events set owner_key = p_new
         where layer = 'private' and club_name = p_club and owner_key = p_old;
        get diagnostics n = row_count; out := out || jsonb_build_object('privateEvents', n);

        -- 手機行事曆訂閱網址（保留原本的網址）
        delete from calendar_ics o where o.club_name = p_club and o.person_key = p_old
           and exists (select 1 from calendar_ics x where x.club_name = p_club and x.person_key = p_new);
        update calendar_ics set person_key = p_new where club_name = p_club and person_key = p_old;

        -- 我要參加（本人、他帶的寶尊眷、執秘代登記的同行者）
        delete from calendar_rsvp o where o.club_name = p_club and o.person_key = p_old
           and exists (select 1 from calendar_rsvp x where x.event_id = o.event_id and x.club_name = p_club and x.person_key = p_new);
        update calendar_rsvp set person_key = p_new, full_name = p_name, nickname = p_nick
         where club_name = p_club and person_key = p_old;
        get diagnostics n = row_count; out := out || jsonb_build_object('rsvp', n);
        update calendar_rsvp set guest_of = p_new where club_name = p_club and guest_of = p_old;
        delete from calendar_rsvp o where o.club_name = p_club and left(o.person_key, length(gp_old)) = gp_old
           and exists (select 1 from calendar_rsvp x where x.event_id = o.event_id and x.club_name = p_club
                        and x.person_key = gp_new || substr(o.person_key, length(gp_old) + 1));
        update calendar_rsvp set person_key = gp_new || substr(person_key, length(gp_old) + 1)
         where club_name = p_club and left(person_key, length(gp_old)) = gp_old;

        -- 例會實際出席
        delete from calendar_attendance o where o.club_name = p_club and o.person_key = p_old
           and exists (select 1 from calendar_attendance x where x.event_id = o.event_id and x.club_name = p_club and x.person_key = p_new);
        update calendar_attendance set person_key = p_new, full_name = p_name, nickname = p_nick
         where club_name = p_club and person_key = p_old;
        get diagnostics n = row_count; out := out || jsonb_build_object('attendance', n);
        delete from calendar_attendance o where o.club_name = p_club and left(o.person_key, length(gp_old)) = gp_old
           and exists (select 1 from calendar_attendance x where x.event_id = o.event_id and x.club_name = p_club
                        and x.person_key = gp_new || substr(o.person_key, length(gp_old) + 1));
        update calendar_attendance set person_key = gp_new || substr(person_key, length(gp_old) + 1)
         where club_name = p_club and left(person_key, length(gp_old)) = gp_old;

        -- 補出席
        update calendar_makeups set person_key = p_new, full_name = p_name, nickname = p_nick
         where club_name = p_club and person_key = p_old;
        get diagnostics n = row_count; out := out || jsonb_build_object('makeups', n);

        -- 誰可以看全社出席率（名單是 JSON 陣列）
        update calendar_report_viewers
           set viewers = (select coalesce(jsonb_agg(distinct case when v = p_old then p_new else v end), '[]'::jsonb)
                            from jsonb_array_elements_text(viewers) v)
         where club_name = p_club and viewers ? p_old;

        -- 總監每日推播的「今天已推過」紀錄（避免改名後同一天再推一次）
        begin
            update calendar_digest_log set gov_key = dk_new where gov_key = dk_old;
            update calendar_digest_log set to_key = dk_new where to_key = dk_old;
        exception when unique_violation then null;
        end;

        -- 姓名有改時，總監秘書留下的標記也要跟著改（「與總監同步」的行程、代總監登記的參加，都是靠這串文字認人）
        if old_name <> '' and old_name <> p_name then
            update calendar_events set created_by = '總監秘書 ' || p_name || '（' || p_club || '）同行'
             where created_by = '總監秘書 ' || old_name || '（' || p_club || '）同行';
            update calendar_rsvp set proxy_by = '總監秘書 ' || p_name || '（' || p_club || '）'
             where proxy_by = '總監秘書 ' || old_name || '（' || p_club || '）';
        end if;
    end if;

    -- ---------- 誰可以看報名／繳費狀況 ----------
    if to_regclass('public.calendar_stat_viewers') is not null then
        delete from calendar_stat_viewers o where o.club_name = p_club and o.person_key = p_old
           and exists (select 1 from calendar_stat_viewers x where x.event_key = o.event_key and x.club_name = p_club and x.person_key = p_new);
        update calendar_stat_viewers set person_key = p_new, full_name = p_name, nickname = p_nick
         where club_name = p_club and person_key = p_old;
        get diagnostics n = row_count; out := out || jsonb_build_object('statViewers', n);
    end if;

    -- ---------- 系統管理者（備份提醒收件人，存成一段 JSON 文字） ----------
    if to_regclass('public.calendar_settings') is not null then
        begin
            update calendar_settings s
               set value = (select coalesce(jsonb_agg(e), '[]'::jsonb)::text from (
                               select distinct on (e->>'club', e->>'key') e from (
                                   select case when x->>'club' = p_club and x->>'key' = p_old
                                               then jsonb_build_object('club', p_club, 'key', p_new, 'name', p_name, 'nickname', p_nick)
                                               else x end as e
                                     from jsonb_array_elements(s.value::jsonb) x) t) u)
             where s.key = 'backup_notify';
        exception when others then null;   -- 內容不是合法 JSON 就不動它
        end;
    end if;

    -- ---------- 社費推播：上次填的個別品項（存在 JSON 裡，以「姓名|Nick Name」當索引） ----------
    if to_regclass('public.club_dues_state') is not null then
        update club_dues_state
           set data = jsonb_set(data, '{members}', ((data->'members') - p_old) || jsonb_build_object(p_new, data->'members'->p_old))
         where club_name = p_club and data->'members' ? p_old and not (data->'members' ? p_new);
    end if;

    -- ---------- 活動照片找人：大頭照（檔名是亂數，所以只要改這一欄，檔案不用搬） ----------
    if to_regclass('public.member_portraits') is not null then
        update member_portraits set person_key = p_new where club_name = p_club and person_key = p_old;
        get diagnostics n = row_count; out := out || jsonb_build_object('portraits', n);
    end if;

    -- ---------- 活動照片找人：比對結果與已通知紀錄 ----------
    if to_regclass('public.photo_matches') is not null then
        delete from photo_matches o where o.club_name = p_club and o.person_key = p_old
           and exists (select 1 from photo_matches x where x.job_id = o.job_id and x.club_name = p_club and x.person_key = p_new and x.file_id = o.file_id);
        update photo_matches set person_key = p_new where club_name = p_club and person_key = p_old;
        get diagnostics n = row_count; out := out || jsonb_build_object('photoMatches', n);
        delete from photo_notified o where o.club_name = p_club and o.person_key = p_old
           and exists (select 1 from photo_notified x where x.job_id = o.job_id and x.club_name = p_club and x.person_key = p_new);
        update photo_notified set person_key = p_new where club_name = p_club and person_key = p_old;
    end if;

    return out;
end $$;

revoke all on function public.member_rename_move(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.member_rename_move(text, text, text, text, text) to service_role;
