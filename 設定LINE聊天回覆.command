#!/bin/bash
# 在 Finder 點兩下這個檔案：設定「LINE 聊天室關鍵字回覆」要用的 Channel secret（官方帳號 Messaging API 頻道）。
#   - Channel secret 用來確認 Webhook 收到的訊息真的是 LINE 傳來的（不是有人假冒）。
#   - 只存在 Supabase 的 secrets，不會寫進程式、也不會出現在網頁上。
cd "$(dirname "$0")"
REF=ncrvmhfggfczicpyebvn
echo "========================================"
echo " 設定 LINE 聊天室關鍵字回覆（3523）"
echo "========================================"
echo "請到 LINE Developers → 官方帳號的 Messaging API 頻道 → Basic settings → Channel secret，按 Issue 旁邊的複製。"
echo
read -s -p "請貼上 Channel secret（貼上時畫面不會顯示），再按 Enter：" SEC; echo
SEC="$(echo -n "$SEC" | tr -d '[:space:]')"
if [ -z "$SEC" ]; then echo "❌ 沒有收到內容，已取消。"; read -p "按 Enter 關閉視窗…"; exit 1; fi
if [ ${#SEC} -ne 32 ]; then echo "⚠️ Channel secret 通常是 32 個字元，你貼上的是 ${#SEC} 個字元，請確認有沒有貼錯（例如貼成 Channel access token）。"; read -p "仍要繼續設定嗎？(y/N) " A; [ "$A" = "y" ] || [ "$A" = "Y" ] || exit 1; fi
supabase secrets set LINE_MESSAGING_CHANNEL_SECRET="$SEC" --project-ref $REF
if [ $? -eq 0 ]; then echo; echo "✅ 已設定完成！接下來回到 LINE Developers 設定 Webhook URL 並按 Verify。"; else echo; echo "❌ 設定失敗，請把上面的紅字截圖給 Claude。"; fi
echo; read -p "按 Enter 關閉視窗…"
