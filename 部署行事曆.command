#!/bin/bash
# 在 Finder 點兩下這個檔案：
#   1. 把 line-checkin 雲端小程式（含行事曆功能）上傳到 Supabase（專案 Rotary-3523）
#   2. 詢問要不要設定「行事曆後台密碼」（第一次一定要設；之後想換密碼也從這裡）
cd "$(dirname "$0")"
REF=ncrvmhfggfczicpyebvn
# 上傳前先把報到共用邏輯複製一份進小程式資料夾（小程式只能打包自己資料夾裡的檔案）
cp checkin-core.js supabase/functions/line-checkin/checkin-core.js
echo "========================================"
echo " 正在上傳雲端小程式 line-checkin …"
echo "========================================"
supabase functions deploy line-checkin --project-ref $REF --no-verify-jwt
STATUS=$?
if [ $STATUS -ne 0 ]; then
  echo; echo "❌ 上傳失敗，請把上面的紅字截圖給 Claude。"
  echo "   （若出現 Access token not provided，請先在終端機輸入 supabase login）"
  read -p "按 Enter 關閉視窗…"; exit 1
fi
echo; echo "✅ 上傳成功！"; echo
read -p "要設定／更換「行事曆後台密碼」嗎？(y/N) " ANS
if [ "$ANS" = "y" ] || [ "$ANS" = "Y" ]; then
  read -s -p "請輸入新的後台密碼（輸入時畫面不會顯示）：" PW; echo
  if [ -z "$PW" ]; then echo "密碼是空的，已略過。"; else
    supabase secrets set CALENDAR_ADMIN_PASSWORD="$PW" --project-ref $REF && echo "✅ 後台密碼已設定。"
  fi
fi
echo; read -p "按 Enter 關閉視窗…"
