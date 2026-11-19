#!/bin/bash
# 在 Finder 點兩下這個檔案：讓 Claude Code 能「唯讀」查看 3523 的 Supabase（資料表與雲端執行紀錄）。
#   - read_only=true：只能查，不能新增、修改、刪除任何資料。
#   - project_ref：只限 3523 正式資料庫，看不到 3521 或帳號底下其他專案。
#   - 只加在這個資料夾（local），其他專案資料夾不受影響；不會寫進 git。
#   - 這裡沒有任何密碼；第一次使用時要在 Claude Code 輸入 /mcp 用瀏覽器登入 Supabase 授權。
cd "$(dirname "$0")"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
REF=ncrvmhfggfczicpyebvn
URL="https://mcp.supabase.com/mcp?project_ref=${REF}&read_only=true"
echo "========================================"
echo " 連結 Supabase MCP（只限 3523、唯讀）"
echo "========================================"
if ! command -v claude >/dev/null 2>&1; then
  echo "❌ 找不到 claude 指令，請把這個畫面截圖給 Claude。"; read -p "按 Enter 關閉視窗…"; exit 1
fi
# 若之前加過同名的連結，先移除再重新加入（確保設定是唯讀、只限 3523）
claude mcp remove supabase -s local >/dev/null 2>&1
claude mcp add --scope local --transport http supabase "$URL"
if [ $? -eq 0 ]; then
  echo
  echo "✅ 已加入！接下來："
  echo "  1. 關掉 Claude Code 再重新打開（在這個資料夾）。"
  echo "  2. 輸入 /mcp，選 supabase，按 Authenticate。"
  echo "  3. 瀏覽器會開 Supabase 授權頁，登入後按允許。"
  echo "  4. 回到 Claude Code 告訴 Claude「MCP 連好了」。"
else
  echo; echo "❌ 加入失敗，請把上面的訊息截圖給 Claude。"
fi
echo; read -p "按 Enter 關閉視窗…"
