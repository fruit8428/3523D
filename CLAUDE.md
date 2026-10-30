# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概述

國際扶輪 3523 地區活動整合報名系統。**整個應用程式就是一個檔案 `index.html`**（約 7,800 行、440 KB），
HTML、CSS、JavaScript 全部內嵌，沒有打包、沒有建置步驟、沒有框架。資料庫用 Supabase，部署用 GitHub Pages。

`README.md` 是給客戶看的功能說明（繁體中文），修改功能時記得同步更新。

## 常用指令

```bash
# 本機預覽（直接用 file:// 開啟也可以，但 puppeteer 測試腳本固定連 8000 埠）
python3 -m http.server 8000
# 瀏覽 http://localhost:8000/index.html

# 安裝測試用套件（puppeteer、@supabase/supabase-js）
npm install

# JavaScript 語法檢查：把所有 <script> 抽成 test.js 再用 node 檢查
# 一個語法錯誤就會讓整個 App 白畫面（歷史上發生過兩次），改完程式一定要跑
node extract_js.js && node -c test.js

# 瀏覽器冒煙測試（需先啟動 8000 埠的 http.server）
node check_load.js      # 以最高管理員登入，確認社友名冊有載入
node check_modal.js     # 其他 check_*.js 同理，各自驗證一個流程

# 測試 Supabase 連線與 app_storage 資料表讀寫
node test_supabase.js
```

沒有 lint、沒有單元測試框架。`check_*.js`、`check_*.py` 是臨時寫的驗證腳本，可以參考其寫法新增驗證。

## 部署

- 遠端：`https://github.com/fruit8428/3523D.git`，分支 `main`。
- **push 到 `main` 即自動部署**：`.github/workflows/deploy.yml` 把整個 repo 根目錄上傳到 GitHub Pages。
  本專案**不是**用 Vercel，正式網址是 GitHub Pages 網址。
- 因為是靜態網站，Supabase 的 URL 與 anon key 直接寫在 `index.html` 第 21–22 行，這是刻意的設計；
  資料安全靠 Supabase 端的 Row Level Security 設定。

### Supabase 資料表（只有一張）

整個系統只用一張 `app_storage` 表當 key-value 儲存。若要重建專案或換資料庫，在 Supabase SQL Editor 執行：

```sql
CREATE TABLE IF NOT EXISTS public.app_storage (
    key   TEXT PRIMARY KEY,
    value JSONB NOT NULL
);
ALTER TABLE public.app_storage ENABLE ROW LEVEL SECURITY;
-- 前端直接用 anon key 讀寫，所以 RLS 必須對 anon 開放全部操作，否則 upsert 會靜默失敗
CREATE POLICY "Allow anon all operations" ON public.app_storage
    FOR ALL TO anon USING (true) WITH CHECK (true);
```

換資料庫時要同步改 `index.html`、`test_supabase.js`、`test_supabase2.js` 三處的 URL 與 key。

## 架構（讀懂這段才改得動程式）

### 檔案角色

| 檔案 | 說明 |
|---|---|
| `index.html` | **唯一要編輯的程式碼來源**，GitHub Pages 實際提供的檔案。 |
| `rotary_3523_event_registration_spa.html`、`rotary_3523_event_registration_spa (1).html` | `index.html` 的歷史複本（目前內容完全相同），不要在這兩個檔案上開發。 |
| `patch_*.py`、`fix_*.py` | 過去各次對話用來對 `index.html` 做字串取代的一次性腳本，**不是建置系統，不可重跑**（不具冪等性）。 |
| `test.js` | `extract_js.js` 產生的輸出，不要手動編輯。 |
| `stub.js` | 在 node 裡 require `test.js` 用的 DOM/Supabase 假物件。 |

### `index.html` 內部結構

1. 第 17–27 行：載入 supabase-js CDN，建立全域 `supabaseClient`（建立失敗則為 `null`，所有儲存會自動退回 localStorage）。
2. 第 37 行起：Tailwind CDN 設定（自訂 `rotary.*` 色票）與自訂 CSS。
3. 第 400–1950 行左右：HTML 骨架。四個主要畫面各是一個 `<section>`：
   `viewSecretary`（執秘報名）、`viewChair`（主委儀表板）、`viewSuperAdmin`（最高權限管理）、`viewArch`（名冊/生命週期）。
   登入遮罩 `loginOverlay` 蓋在最上層。
4. 第 1951 行起：主程式。順序為「預設資料 → 全域狀態變數 → 儲存層 → DOMContentLoaded → 各功能函式 → 登入/權限」。

### 狀態與資料模型（全部是全域 `let` 變數）

- `divisionsData`：13 分區、80 社的名冊，預設值 `DEFAULT_DIVISIONS_DATA` 來自 `3523地區現有社名排序.xlsx`。
- `categoriesData`：活動大類陣列。每個大類有 `id`、`name`、`allowSponsors`、`allowAddSubEvents`，以及 `subEvents`（**純字串陣列**）。
- `clubMemberDatabase`：`{ [社名]: Member[] }`，Member 含 `role`、`nickname`、`name`、`diet`、`veganNote`、`handicap`、`spouseOfId`。
- `registrationOrders`：`{ [子活動名稱字串]: Order[] }`，每社每子活動一筆 Order。
- `chairConfig`：各種費用金額與贊助開關。其中社慶的友社花款與每人餐費**依子活動分別儲存**在 `chairConfig.subEventFees["大類id::子活動名稱"]`，透過 `getFlowerFee()` / `getAnnivMealFee()` 讀取、`setSubEventFee()` 寫入；其餘費用（參賽、只用餐、共同主辦社等）仍是全域一份，所有子活動共用。
- `appAuthData`：`{ clubPasswords: {社名: 密碼}, eventChairs: {key: 社名[]} }`。

**重要：子活動以名稱字串當 key。** `registrationOrders` 與 `appAuthData.eventChairs` 都用子活動名稱當索引，
重新命名子活動會讓既有報名與主委指派變成孤兒資料；刪除子活動的函式（`handleConfirmDeleteSubEvent`）有處理，新增類似功能時要比照。

### 儲存層（`saveToStorage` / `loadFromStorage`，約 2608 行）

- 整個狀態打包成**一個 JSON**，以 key `rotary_3523_spa_data_v3` 存進 Supabase 資料表 `app_storage`（欄位 `key`、`value` jsonb），用 `upsert` 覆寫。
- 另外三個獨立 key：`rotary_3523_event_emails_v1`、`rotary_3523_payment_records_v1`、`rotary_3523_email_inbox_logs_v1`，各有自己的 load/save 函式。
- 整包覆寫代表「最後寫入者獲勝」，沒有合併邏輯。
- 所有會寫入的操作必須 `await saveToStorage()` **之後**才關閉 modal 或重新渲染，否則使用者快速重整會遺失資料（commit 61ef719 修過這個問題）。
- `loadFromStorage` 內有資料遷移邏輯（補齊新欄位預設值、強制加入「地區年會」大類等），新增狀態欄位時要在這裡補預設值，否則舊資料載入會 `undefined`。

### 角色與權限

- `currentRole` 有四種值：`secretary`、`chair`、`super_admin`、`arch`（`arch` 只是檢視頁，不是登入身分）。
- 登入流程：`handleLogin` → `completeLogin` → `applyPermissions`。
  最高管理員密碼寫死在 `handleLogin` 裡（測試腳本也用它登入）；一般社別密碼存在 `appAuthData.clubPasswords`，首次登入走「註冊」分頁自行設定。
- **角色是依「目前所在的大類與子活動」動態算出來的**：`applyPermissions` 檢查
  `eventChairs[catId]`（整個大類的主委）或 `eventChairs["catId::子活動名稱"]`（單一子活動的主委）。
  切換大類或子活動後要重新呼叫 `applyPermissions()`，否則權限不會更新。
- 權限判斷的慣用寫法是 `currentRole === 'chair' || currentRole === 'super_admin'`，新增主委功能時沿用。

### 活動類型切換邏輯

- `isCurrentEventSports()` / `isCurrentEventGolf()`：運動賽事顯示差點欄位與參賽/用餐費用，高爾夫另有平均差點計算。
- 「地辦分攤金」類活動是以**名稱**判斷，不是用 id：大類名稱或子活動名稱包含 `分攤金` 或 `配合款` 即視為分攤金模式（同一段判斷式在 `loadCategoryView`、`updateTotalFeeSummaryDisplay`、`submitRegistration` 各出現一次，修改時要三處一起改）。
- `cat.allowSponsors` 控制贊助社/協辦社區塊；`cat.allowAddSubEvents === false`（RYLA、End Polio）則隱藏子活動增刪按鈕。

### UI 慣例

- 所有事件綁定都寫在 HTML 字串的 `onclick="..."` 屬性裡，因此**每個被呼叫的函式都必須是 `<script>` 頂層的全域函式**，不能包在模組或閉包內。
- 畫面更新靠 `render*` / `update*` 函式重組 `innerHTML`，沒有虛擬 DOM；改一處資料後要找出對應的 render 函式手動呼叫。
- 樣式全用 Tailwind utility class 寫在元素上；主題色由 `applyEventColorTheme` 依大類的 `themeColor` 切換。
- 網址參數：`?role=secretary|chair|arch`、`?cat=<大類 id>`、`?pres=all|<分區編號>`（投影簡報模式）。

## 修改 `index.html` 的注意事項

- 檔案很大，請用精準的字串取代或行號範圍編輯，不要整檔重寫。
- 改完必跑 `node extract_js.js && node -c test.js`。
- 同一個函式名在檔案裡可能出現兩次（例如 `toggleSingleChairOrderRoster`、`copyClubOrderRosterTextByIndex` 各有兩份定義，後者覆蓋前者），
  修改前先 `grep -n "function 名稱"` 確認改到的是生效的那一份。
- 新增報名/社友欄位時，要同時更新：資料模型預設值、`loadFromStorage` 遷移、執秘表格 render、主委儀表板 render、Excel/CSV 匯出（`exportMergedExcelXLSX`、`exportReportCSV`）、LINE 文字產生（`getLineRegistrationText`）。
