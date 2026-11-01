#!/bin/bash
# 在 Finder 點兩下這個檔案，就會把「入帳通知抓信」雲端小程式重新上傳到 Supabase（專案 Rotary-3523）
cd "$(dirname "$0")"
echo "========================================"
echo " 正在上傳雲端小程式 fetch-bank-mail …"
echo "========================================"
supabase functions deploy fetch-bank-mail --project-ref ncrvmhfggfczicpyebvn --no-verify-jwt
STATUS=$?
echo
if [ $STATUS -eq 0 ]; then
  echo "✅ 上傳成功！可以關閉這個視窗。"
else
  echo "❌ 上傳失敗，請把上面的紅字截圖給 Claude。"
  echo "   （若出現 Access token not provided，請先在終端機輸入 supabase login）"
fi
echo
read -p "按 Enter 關閉視窗…"
