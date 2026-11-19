#!/bin/bash
# 在 Finder 點兩下這個檔案：讓 Claude Code 能「唯讀」查看 3521 展示站的 Supabase（資料表與雲端執行紀錄）。
#   - 連結名稱叫 supabase-3521，和 3523 的 supabase 分開，不會搞混。
#   - read_only=true：只能查，不能新增、修改、刪除任何資料。
#   - project_ref：只限 3521（Rotary-3521），看不到 3523 或其他專案。
#   - 只加在這個資料夾（local），不會寫進 git；這裡沒有任何密碼，第一次使用要在 Claude Code 輸入 /mcp 登入授權。
cd "$(dirname "$0")"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
REF=dkzpznvhqzvpeiajyyab
URL="https://mcp.supabase.com/mcp?project_ref=${REF}&read_only=true"
echo "========================================"
echo " 連結 Supabase MCP（只限 3521、唯讀）"
echo "========================================"
if ! command -v claude >/dev/null 2>&1; then
  echo "❌ 找不到 claude 指令，請把這個畫面截圖給 Claude。"; read -p "按 Enter 關閉視窗…"; exit 1
fi
claude mcp remove supabase-3521 -s local >/dev/null 2>&1
claude mcp add --scope local --transport http supabase-3521 "$URL"
if [ $? -eq 0 ]; then
  echo
  echo "✅ 已加入！接下來："
  echo "  1. 在 Claude Code 輸入 /exit，再輸入 claude -c 重新打開（接續原本的對話）。"
  echo "  2. 輸入 /mcp，選 supabase-3521，按 Authenticate。"
  echo "  3. 瀏覽器會開 Supabase 授權頁，登入後按允許。"
  echo "  4. 回到 Claude Code 告訴 Claude「3521 MCP 連好了」。"
else
  echo; echo "❌ 加入失敗，請把上面的訊息截圖給 Claude。"
fi
echo; read -p "按 Enter 關閉視窗…"
