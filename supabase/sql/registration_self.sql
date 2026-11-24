-- ============================================================================
-- 社友在 LINE 自己報名（直接寫進報名表）
-- 2026-11-24：使用者決定「社友在手機按報名＝正式報名並送出，不需執秘再確認」。
--
-- 報名表存在 app_storage 主資料（一大包 JSON）的 registrationOrders["子活動名稱"]，每社一張。
-- 雲端小程式 line-checkin 先算好「這一社的報名表改成什麼」，再呼叫這個函式只換掉那一張，
-- 不必把整包資料下載再上傳，也不會蓋掉別社同時送出的報名（整列鎖定、一筆交易）。
--
-- p_before＝小程式讀到的那一張（沒有＝null）；與資料庫現在的不一樣＝這段時間有人改過，回 'CONFLICT'，小程式會重讀再算一次。
-- p_after ＝要寫入的那一張；null＝整張移除（裡面已經沒有人、也沒有贊助）。
-- 只開放 service_role（雲端小程式），anon 不能呼叫。可以重複執行。
-- ============================================================================
create or replace function public.registration_order_apply(p_sub text, p_club text, p_before jsonb, p_after jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key   constant text := 'rotary_3523_spa_data_v3';
  v_value jsonb;
  v_list  jsonb;
  v_cur   jsonb;
  v_new   jsonb;
begin
  -- 小程式傳來的「沒有」可能是 JSON 的 null，統一當成資料庫的 NULL
  if jsonb_typeof(p_before) = 'null' then p_before := null; end if;
  if jsonb_typeof(p_after)  = 'null' then p_after  := null; end if;
  if coalesce(p_sub, '') = '' or coalesce(p_club, '') = '' then return 'BAD_REQUEST'; end if;
  if p_after is not null and (jsonb_typeof(p_after) <> 'object' or p_after->>'clubName' is distinct from p_club) then return 'BAD_REQUEST'; end if;

  select value into v_value from public.app_storage where key = v_key for update;
  if v_value is null then return 'NO_DATA'; end if;

  v_list := coalesce(v_value->'registrationOrders'->p_sub, '[]'::jsonb);
  if jsonb_typeof(v_list) <> 'array' then v_list := '[]'::jsonb; end if;
  select o into v_cur from jsonb_array_elements(v_list) o where o->>'clubName' = p_club limit 1;

  -- 這段時間有人改過這一社的報名表：不寫入，請小程式重讀再算
  if v_cur is distinct from p_before then return 'CONFLICT'; end if;

  select coalesce(jsonb_agg(o order by ord), '[]'::jsonb) into v_new
    from (
      select case when o->>'clubName' = p_club then p_after else o end as o, ord
        from jsonb_array_elements(v_list) with ordinality t(o, ord)
       where not (o->>'clubName' = p_club and p_after is null)
    ) x;
  if v_cur is null and p_after is not null then v_new := v_new || jsonb_build_array(p_after); end if;

  if jsonb_typeof(v_value->'registrationOrders') is distinct from 'object' then
    v_value := jsonb_set(v_value, '{registrationOrders}', '{}'::jsonb, true);
  end if;
  v_value := jsonb_set(v_value, array['registrationOrders', p_sub], v_new, true);
  -- lastUpdated 一變，開著報名系統的電腦 15 秒內（收到廣播則立刻）就會重新讀取
  v_value := jsonb_set(v_value, '{lastUpdated}', to_jsonb(to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), true);
  update public.app_storage set value = v_value where key = v_key;
  return 'OK';
end $$;

revoke all on function public.registration_order_apply(text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.registration_order_apply(text, text, jsonb, jsonb) to service_role;
