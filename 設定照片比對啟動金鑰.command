#!/bin/bash
# 在 Finder 點兩下這個檔案：設定「活動照片找人」啟動 GitHub 雲端比對要用的金鑰（GitHub token）。
#   - 執秘或管理者貼上照片資料夾連結時，報名系統的雲端小程式會用這把金鑰，通知 GitHub「開始比對」。
#   - 金鑰只存在 Supabase 的 secrets，不會寫進程式、也不會出現在網頁上。
#   - 這把金鑰只需要 photo-finder 這一個倉庫的「Actions：讀寫」權限，其他權限都不要勾。
cd "$(dirname "$0")"
echo "========================================"
echo " 設定 活動照片比對的啟動金鑰"
echo "========================================"
echo "要設定哪一個地區？"
echo "  1) 3521 展示站"
echo "  2) 3523 正式站"
read -p "請輸入 1 或 2，再按 Enter：" W
if [ "$W" = "1" ]; then REF=dkzpznvhqzvpeiajyyab; NAME=3521; elif [ "$W" = "2" ]; then REF=ncrvmhfggfczicpyebvn; NAME=3523; else echo "❌ 沒有選擇，已取消。"; read -p "按 Enter 關閉視窗…"; exit 1; fi
echo
echo "請到 GitHub 產生一把 Fine-grained token（步驟請看 Claude 給的說明），複製後回到這裡。"
read -s -p "請貼上 GitHub token（貼上時畫面不會顯示），再按 Enter：" SEC; echo
SEC="$(echo -n "$SEC" | tr -d '[:space:]')"
if [ -z "$SEC" ]; then echo "❌ 沒有收到內容，已取消。"; read -p "按 Enter 關閉視窗…"; exit 1; fi
case "$SEC" in github_pat_*|ghp_*) ;; *) echo "⚠️ GitHub token 通常是 github_pat_ 開頭，你貼上的不是，請確認有沒有貼錯。"; read -p "仍要繼續設定嗎？(y/N) " A; [ "$A" = "y" ] || [ "$A" = "Y" ] || exit 1;; esac
supabase secrets set PHOTO_GITHUB_TOKEN="$SEC" --project-ref $REF
if [ $? -eq 0 ]; then echo; echo "✅ $NAME 已設定完成！回到 Claude 說「金鑰設好了」。"; else echo; echo "❌ 設定失敗，請把上面的紅字截圖給 Claude。"; fi
echo; read -p "按 Enter 關閉視窗…"
