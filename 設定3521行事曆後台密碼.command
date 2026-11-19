#!/bin/bash
# 在 Finder 點兩下這個檔案：設定 3521 展示站的「行事曆後台密碼」。
#   - 用途：管理地區行程、指派行事曆管理者、總監每日推播（admin-calendar.html 與報名系統的「地區行程」分頁）。
#   - 只存在 3521 Supabase 的 secrets（CALENDAR_ADMIN_PASSWORD），不會寫進程式或網頁，Claude 也不會知道。
#   - 不要用最高管理員密碼（那個寫在網頁程式裡，任何人都看得到）。
cd "$(dirname "$0")"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
REF=dkzpznvhqzvpeiajyyab
echo "========================================"
echo " 設定 3521 行事曆後台密碼"
echo "========================================"
read -s -p "請輸入新密碼（輸入時畫面不會顯示），再按 Enter：" P1; echo
read -s -p "請再輸入一次確認：" P2; echo
if [ -z "$P1" ]; then echo "❌ 沒有輸入密碼，已取消。"; read -p "按 Enter 關閉視窗…"; exit 1; fi
if [ "$P1" != "$P2" ]; then echo "❌ 兩次輸入不一樣，已取消，請重新點兩下再設定。"; read -p "按 Enter 關閉視窗…"; exit 1; fi
if [ ${#P1} -lt 6 ]; then echo "❌ 密碼至少要 6 個字元。"; read -p "按 Enter 關閉視窗…"; exit 1; fi
supabase secrets set CALENDAR_ADMIN_PASSWORD="$P1" --project-ref $REF
if [ $? -eq 0 ]; then echo; echo "✅ 已設定完成！約 10 秒後生效，可以到 https://3521d.vercel.app/admin-calendar.html 用這組密碼登入。"; else echo; echo "❌ 設定失敗，請把上面的紅字截圖給 Claude。"; fi
echo; read -p "按 Enter 關閉視窗…"
