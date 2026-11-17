-- ============================================================================
-- 一次性：把「現有」的地區行程與社內行程，全部改成「開放社友按我要參加」（2026-11-17）
-- 只需要執行一次。之後新增的行程預設就是開啟的，不用再跑。
-- 私人行程不受影響。已取消的行程也一起打開（取消的行程本來就不能按參加，打開也沒影響）。
-- 執行後如果某個行程不想開放，到「行事曆管理」按「編輯」取消勾選即可。
-- ============================================================================
update public.calendar_events
   set rsvp_enabled = true, updated_at = now()
 where layer in ('district', 'club') and rsvp_enabled = false;

-- 執行結果檢查：下面應該顯示 0
select count(*) as 尚未開放的地區或社內行程 from public.calendar_events where layer in ('district', 'club') and rsvp_enabled = false;
