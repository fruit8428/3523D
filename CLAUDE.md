# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概述

國際扶輪 3523 地區活動整合報名系統。**主程式就是一個檔案 `index.html`**（約 10,200 行），另有獨立的櫃台報到頁 `checkin.html`（與共用邏輯 `checkin-core.js`，見「活動報到系統」），
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
- **push 到 `main` 即自動部署到兩個地方**，程式內容相同、共用同一個 Supabase 資料庫：
  - GitHub Pages：`.github/workflows/deploy.yml` 把整個 repo 根目錄上傳，網址 `https://fruit8428.github.io/3523D/`。
  - Vercel：專案 `3523d`（帳號 `fruit8428-3918`）已連結此 repo，網址 `https://3523d.vercel.app`，不需任何建置設定。
  驗證上線時兩個網址都要 curl 比對 md5 是否與本機 `index.html` 一致。
- 因為是靜態網站，Supabase 的 URL 與 anon key 是可公開的 publishable 金鑰，放在地區設定檔 `config/districts/3523.json`（見下方「地區設定」），
  資料安全靠 Supabase 端的 Row Level Security 設定。
- `vercel.json`：`installCommand` 跳過安裝、`buildCommand` 執行 `node scripts/build-config.js`、`outputDirectory` 為根目錄；`.vercelignore` 排除測試腳本與大圖。

### 地區設定（去地區化，2026-11-05 起）

所有地區專屬內容都不寫在 `index.html`，而是：`config/districts/<代號>.json`（地區代號、名稱、年度、Logo、Supabase 連線、AI 小幫手網址、分區與社名冊）
→ `node scripts/build-config.js`（依 `DISTRICT_CODE` 環境變數，預設 3523；或 `DISTRICT_CONFIG_FILE` 指定檔案）→ 產生 `district-config.js`（定義 `window.DISTRICT`）。
- **3523 版的 `district-config.js` 有進 git** 當預設值，所以 file://、GitHub Pages、現有 Vercel 都不需建置；改 3523 設定後要重新產生並一起 commit。其他地區在 Vercel 設 `DISTRICT_CODE` 即可。
- `index.html` 讀取方式：JS 用 `DISTRICT.xxx`；HTML 靜態文字用 `data-district-text="{name}…"` / `data-district-html` 樣板，由 `applyDistrictBranding()` 在 DOMContentLoaded 最先填入（可用變數 `{code} {name} {nameEn} {rotaryYear} {rotaryYearLong} {yearStart} {divisionCount} {clubCount}`（後兩者為不含地區團隊的分區數／社數，畫面上不要寫死「13 分區 80 社」））；Logo 用 `data-district-logo`。
- `DEFAULT_DIVISIONS_DATA` 來自 `DISTRICT.divisions`；但 `loadFromStorage` 讀到雲端已存的 `divisionsData` 時會覆蓋（既有行為，名冊可在 UI 編輯），設定檔只是新資料庫的初始值。
- 儲存 key 名稱（`rotary_3523_spa_data_v3` 等 5 個）**刻意不改**：改了會讓 3523 現有資料變孤兒，各地區各自一個 Supabase 所以沒有衝突。
- 新增地區專屬文字時不要寫死，用上面的機制；`config/districts/_template.json` 是新地區範本。
- 驗證腳本 `check_district.js`：用測試設定建置後檢查標題／名冊／連線都跟著變，最後自動還原 3523 並比對 md5。
- AI 小幫手：`DISTRICT.ragAssistantUrl` → `RAG_ASSISTANT_URL`，執秘快捷列 `#ragAssistantBtn` 由 `openRagAssistant()` 以 `?club=社名` 開啟 Agentic RAG（獨立專案 `/Users/fruit/Documents/AI Agent/RAG`，整合計畫見 `AGENTIC_RAG_整合計畫.md`）。

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

### Supabase Storage（活動 DM 檔案）

活動 DM（PDF/JPG/PPT）的檔案本體存在 Storage bucket `event-dm`（公開讀取，anon 可 insert/select/update/delete），
建立 SQL 見 README「活動 DM 檔案空間設定」。檔案清單存在 `chairConfig.eventDMs["大類id::子活動名稱"]`
（`{name, path, url, ext, size, uploadedAt, uploadedBy}`），上傳/刪除走 `handleEventDMUpload` / `removeEventDM`，
顯示走 `renderEventDMList()`（主委後台清單 `#eventDMList` 與執秘端連結列 `#secretaryDMBox`），在 `updateRolePermissionsUI` 內重繪。
圖片與 PDF 的 DM（`isEventDMViewable`）點開時走站內全螢幕視窗 `#dmViewerOverlay`（`openEventDMViewer(idx)` 回傳 false 攔下連結），因為 iPad 直接開檔案網址無法滿版：圖片用 `<img>` 寬度滿版（可切「整頁顯示」）；PDF 由 `renderEventDMPdf` 用 pdf.js 3.11.174（第一次開 PDF 才從 cdnjs 載入，cmaps 來自 jsdelivr）逐頁畫成與螢幕同寬的 canvas，以 IntersectionObserver 只畫可視範圍附近的頁面、捲遠即釋放（iPad canvas 記憶體有限；**不要改用 iframe**，iOS 的 iframe 只顯示 PDF 第一頁）；載入失敗會顯示「改用新分頁開啟」。PPT 仍開新分頁。
bucket 不存在或 policy 未開時上傳會失敗，`describeEventDMError()` 會轉成中文提示。

### 入帳通知自動對帳（上海商銀）

- 後端：`supabase/functions/fetch-bank-mail/`，`index.ts` 只負責讀設定／寫資料表／回狀態，核心在 `lib.ts`（`fetchBankNotices`、`parseNotice`、`extractPdfText`，index.ts 與本機測試腳本共用）。IMAP 用自製的 `imap.ts`（`SimpleImap`，Deno 原生 `Deno.connectTls`，信件以 64 KB 分段 `BODY.PEEK[]<off.len>` 下載；**不要改回 imapflow**，它在 Supabase 雲端下載大信件會無聲掛住）、信件解析 `npm:mailparser`（要餵 `Buffer`）、PDF 用 `npm:unpdf`。Supabase 每次請求 CPU 上限 2 秒，所以每次最多解 4 個 PDF（`maxNew`），每筆解析完立刻 `onNotice` 寫入，回傳 `pending`，前端「立即抓取」會自動續抓、排程每 10 分鐘補抓。每個階段透過 `onProgress` 寫入 `bank_mail_status.last_result`，總時限 100 秒。**上海商銀通知信本文沒有金額，明細在加密 PDF 附件（密碼＝戶名統編／身分證末六碼，存 `bank_mail_settings.pdf_password`）**；流程是 SEARCH SINCE 60 天 → 只抓信封挑出寄件者/主旨像銀行的信 → 對新信下載原文 → 取 PDF 附件（銀行把它標成 text/plain，用檔名或 `%PDF` 檔頭判斷）→ 解密讀字 → `parseNotice`。去重 key `mail_uid` 用 Message-ID（HiNet 的 UID 不固定，`UIDNOTSTICKY`）。HiNet 收信主機 `msa.hinet.net:993`，用一般登入密碼。以 `--no-verify-jwt` 部署，pg_cron 每 10 分鐘 POST 一次；SQL 在 `supabase/sql/bank_mail_setup.sql`。
- 本機測試後端：已安裝 `deno`（Homebrew）。專案目錄有 node_modules，Deno 指令要加 `--node-modules-dir=none` 才會自動下載 npm 套件：`deno check --node-modules-dir=none supabase/functions/fetch-bank-mail/index.ts`。真實抓信流程可寫小腳本 import `lib.ts` 的 `fetchBankNotices`，帳密用環境變數傳入、不寫資料庫。
- **執秘回報匯款功能已移除（2026-11-12）**：執秘端不再有回報表單，`reconcileBankTransactions()` 改由 `findAutoMatchTarget(tx)` 直接比對——存摺備註以 `findClubByNoteKeyword` 認出社名，金額等於該社某個未繳活動的 `requiredAmountForKey(key, club)`（分攤金＝報名表的 `apportionmentFee` 或主委設定的 `feeApportionment`；研討會／年會＝主委**明確設定**的 `feeApportionment`；其他＝報名表 `grandTotal`）；同主選單多個同額未繳項目取排在前面的，跨主選單則不自動配對。下面提到的 `NOTIFIED`、`submitRemitNotice()` 只為相容舊資料保留，沒有 UI 會再產生；圖表與編輯視窗已不顯示該狀態。
- 前端：`chairConfig.bankAccount`（全活動共用匯款帳號）；繳費紀錄新增狀態 `NOTIFIED`（執秘已回報，含 `remitNote/remitAmount/remitDate/notifiedAt`）。`submitRemitNotice()` 寫入 NOTIFIED 並呼叫 `triggerBankMailFetch()`；`loadBankData()` 讀入帳紀錄與狀態後 `reconcileBankTransactions()` 比對（規則見 `findTransactionForRecord`：備註完全相同／純數字包含／最長唯一社名關鍵字，金額一致、日期 3 天內），成功則 `applyTransactionToRecord()` 標 `PAID_EMAIL` 並把配對寫回 `bank_transactions.matched_*`。主委可 `assignBankTransactionToClub()` 手動指定。顯示：執秘端 `#remitInfoBox`（`renderRemitInfoBox`，**所有大類**都顯示，只要主委填了匯款帳號且已選社；應繳金額 `getRequiredRemitAmount()`：分攤金＝執秘填的金額、研討會／年會＝`getApportionmentFee()`、其他（運動賽事、社慶、RYLA…）＝該社已送出報名表的 `grandTotal`，未送出則取表單目前總計 `#regGrandTotalDisplay`；`updateTotalFeeSummaryDisplay` 末尾會重繪）、主委端 `#bankMailBox`（`renderChairBankMailSection`）。
- 主委後台「本活動銀行入帳明細」面板（`eventIncome`，`renderEventIncomeBox`，所有大類含運動賽事）列出 `matched_key === getActivePaymentKey()` 的入帳與合計，以及該 key 下 `NOTIFIED` 的社；入帳可 `assignBankTransactionToEvent()` 先歸入活動（`matched_club` 為 null＝社別待確認）、`assignAllUnmatchedToEvent()` 批次歸入（備註含社名者自動指定社別）。
- `isPaid` 的判斷式（`PAID_EMAIL || PAID_MANUAL || EXEMPT`）在檔案中出現十多次，NOTIFIED 視為未繳；新增狀態時要全部一起看。

## 架構（讀懂這段才改得動程式）

### 檔案角色

| 檔案 | 說明 |
|---|---|
| `index.html` | **唯一要編輯的程式碼來源**，GitHub Pages 實際提供的檔案。 |
| `config/districts/*.json`、`scripts/build-config.js`、`district-config.js` | 地區設定與其產生物（見「地區設定」）。 |
| `rotary_3523_event_registration_spa.html`、`rotary_3523_event_registration_spa (1).html` | `index.html` 的歷史複本（目前內容完全相同），不要在這兩個檔案上開發。 |
| `patch_*.py`、`fix_*.py` | 過去各次對話用來對 `index.html` 做字串取代的一次性腳本，**不是建置系統，不可重跑**（不具冪等性）。 |
| `test.js` | `extract_js.js` 產生的輸出，不要手動編輯。 |
| `checkin.html` | 櫃台報到頁（獨立頁面，只讀 `app_storage`、絕不寫回）。見「活動報到系統」。 |
| `line.html` | LINE 自助報到頁（LIFF 的 Endpoint，社友在 LINE 裡開啟）。不直接碰資料庫，全部透過雲端小程式 `line-checkin`。 |
| `club-dues.js` | 社費推播的填寫畫面（執秘用，見「社費推播」）。 |
| `global-grants.js` | 全球獎助金查詢畫面（見「全球獎助金查詢」）。 |
| `checkin-core.js` | 報到的純函式（應到名單、合併報到紀錄、統計），`index.html` 與 `checkin.html` 共用，可用 node 直接測。 |
| `stub.js` | 在 node 裡 require `test.js` 用的 DOM/Supabase 假物件。 |

### `index.html` 內部結構

1. 第 17–27 行：載入 supabase-js CDN，建立全域 `supabaseClient`（建立失敗則為 `null`，所有儲存會自動退回 localStorage）。
2. 第 37 行起：Tailwind CDN 設定（自訂 `rotary.*` 色票）與自訂 CSS。
3. 第 400–1950 行左右：HTML 骨架。四個主要畫面各是一個 `<section>`：
   `viewSecretary`（執秘報名）、`viewChair`（主委儀表板）、`viewSuperAdmin`（最高權限管理）、`viewArch`（名冊/生命週期）。
   登入遮罩 `loginOverlay` 蓋在最上層。
4. 第 1951 行起：主程式。順序為「預設資料 → 全域狀態變數 → 儲存層 → DOMContentLoaded → 各功能函式 → 登入/權限」。

### 狀態與資料模型（全部是全域 `let` 變數）

- `divisionsData`：13 分區、80 社的名冊，預設值 `DEFAULT_DIVISIONS_DATA` 來自 `3523地區現有社名排序.xlsx`。 另有第 14 分區「地區團隊」只含「地區辦公室」一社，**存在的目的只是能被指派為活動主委**（地辦人員協助後台），永遠不需繳費；所有繳費相關迭代一律用 `getPaymentDivisions()`（排除地區辦公室），登入選單、主委指派、社友庫等仍用 `divisionsData`。
- `categoriesData`：活動大類陣列。每個大類有 `id`、`name`、`allowSponsors`、`allowAddSubEvents`，以及 `subEvents`（**純字串陣列**）。
- `clubMemberDatabase`：`{ [社名]: Member[] }`，Member 含 `role`、`nickname`、`name`、`diet`、`veganNote`、`handicap`、`spouseOfId`。
- `registrationOrders`：`{ [子活動名稱字串]: Order[] }`，每社每子活動一筆 Order。Order 內 `prizeSponsors[]` 為「贊助獎」（僅運動賽事，`{memberId, role, nickname, name, type:'cash'|'gift', amount, giftName, meal}`），由社友個人捐贈，**不計入**該社 `grandTotal`；勾 `meal` 且不在 `items` 內者透過 `getPrizeMealGuests(prizes, items)` **列入用餐人數與葷素統計但費用為 0**；顯示與文字一律走 `prizeSponsorLineText()` / `prizeSponsorSummaryText()`。
- `chairConfig`：各種費用金額與贊助開關。**所有費用都依子活動分別儲存**在 `chairConfig.subEventFees["大類id::子活動名稱"]`（參賽 `feeCompete`、只用餐 `feeMealOnly`、共同主辦社 `feeCoHost`、協辦社 `feeOrganizer`、贊助社 `feeSponsor`、研習會每社應繳 `feeApportionment`、社慶花款 `feeFlower`、社慶餐費 `feeAnnivMeal`），一律透過 `getCompeteFee()` / `getCoHostFee()` / `getFlowerFee()` 等 getter 讀取、`setSubEventFee()` 寫入，**不要直接讀 `chairConfig.feeXxx`**；`chairConfig.feeXxx` 頂層欄位只剩「該子活動尚未設定時的 fallback」用途。切換子活動後呼叫 `refreshSubEventFeeInputs()` 同步後台輸入欄與執秘端卡片金額。
- `appAuthData`：`{ clubPasswords: {社名: 密碼}, eventChairs: {key: 社名[]} }`。

**重要：子活動以名稱字串當 key。** `registrationOrders` 與 `appAuthData.eventChairs` 都用子活動名稱當索引，
重新命名子活動會讓既有報名與主委指派變成孤兒資料；刪除子活動的函式（`handleConfirmDeleteSubEvent`）有處理，新增類似功能時要比照。

### 儲存層（`saveToStorage` / `loadFromStorage`，約 2608 行）

- 整個狀態打包成**一個 JSON**，以 key `rotary_3523_spa_data_v3` 存進 Supabase 資料表 `app_storage`（欄位 `key`、`value` jsonb），用 `upsert` 覆寫。
- 另外三個獨立 key：`rotary_3523_event_emails_v1`、`rotary_3523_payment_records_v1`、`rotary_3523_email_inbox_logs_v1`，各有自己的 load/save 函式。其中活動信箱與對帳信件兩個 key 所屬的「Email 自動抓取/模擬匯款信」功能已整個移除（2026-10-31），變數與 load/save 仍保留只為相容舊資料，沒有任何 UI 會再寫入。
- `chairPaymentRecords`（繳費紀錄）的 key 是 **`大類id::子活動名稱`**（由 `getActivePaymentKey()` 產生），每個研討會/年會子活動各自一張繳費表；舊的 `seminars` / `conference` 兩桶已不再讀取。
- **示範資料不會自動生成**：`loadDemoPaymentRecords()`、`DEFAULT_MEMBERS_DB`、`DEFAULT_ORDERS` 只有最高管理員在「正式上線前資料歸零」卡片按「載入示範資料」才會寫入；`selectClub` 與新增社都只建立空名冊。**整批清空的功能（`adminClearPaymentData`／`adminClearRegistrationOrders`／`adminClearMemberDatabase`）已於 2026-11-20 依使用者要求全部移除，不要再加回來**；清空資料一律走「歷屆備份與清空單一活動」（逐活動、先備份）。卡片 `data-panel="adminReset"` 只剩「載入示範資料」。
- 執秘送出研討會/年會報名表**不會**自動標記已繳費；繳費狀態只由主委在繳費表手動核訖或貼上銀行通知核對。繳費表的應繳金額一律用 `getApportionmentFee()`（各社應繳金額），不再寫死 10000/20000。
- 整包覆寫代表「最後寫入者獲勝」，沒有合併邏輯。
- **切換大類／子活動不可以存檔**：`applyCurrentEventMode` 以 `toggleSponsorConfig(mode, true)` 呼叫，`fromNavigation=true` 時不 `saveToStorage()`（2026-11-13 修正；以前每點一次選單就整包寫回，舊資料的裝置會蓋掉別人的報名）。新增「只是換畫面」的程式路徑時不要順手存檔。
- 主委改費用後會自動重算已送出的報名表：`recalcSubmittedOrdersForCurrentEvent()`（`saveChairSettings` 與 `liveUpdateChairFee` 停止輸入 1 秒後呼叫），算法要與 `submitRegistrationInner` 保持一致（改其中一邊時另一邊也要改）；分攤金是執秘自己填的金額所以不重算。其他裝置同步到新費用時，`pullRemoteState` 會清掉運動賽事表單的 `fee` 快照並重畫報名表。
- 即時同步（2026-11-12）：`saveToStorage` / `savePaymentRecords` 存檔後用 Supabase Realtime **廣播**（頻道 `rotary-live-sync`，`notifyLiveSyncPeers`）通知其他裝置，收到的裝置 `pullRemoteState(true)` 重新讀 `app_storage` 再 `refreshUIAfterLiveSync()` 重畫（主委後台報名表、繳費表、DM、匯款區塊），不需重新整理；備援是每 15 秒比對 `value->>lastUpdated`（`liveSyncStamp`）、主委每 60 秒強制抓一次、回到分頁時檢查。廣播只是訊號，資料庫不需開 Realtime 複寫。存檔進行中（`liveSyncPendingSaves`）或下載期間本機又存過檔（`liveSyncSaveSeq`）就不套用遠端資料；使用者正在後台輸入或有 Modal 開著時延後重畫（`liveSyncUserIsEditing`）。`submitRegistration` 送出前會先 `pullRemoteState(true)` 再寫入並 `await saveToStorage()`（回傳 false＝存檔失敗會 alert），避免蓋掉別社剛送出的報名；**其他寫入路徑仍是整包覆寫**，只是本機資料最多落後約 15 秒。
- 所有會寫入的操作必須 `await saveToStorage()` **之後**才關閉 modal 或重新渲染，否則使用者快速重整會遺失資料（commit 61ef719 修過這個問題）。
- `loadFromStorage` 內有資料遷移邏輯（補齊新欄位預設值、強制加入「地區年會」大類等），新增狀態欄位時要在這裡補預設值，否則舊資料載入會 `undefined`。

### 角色與權限

- `currentRole` 有四種值：`secretary`、`chair`、`super_admin`、`arch`（`arch` 只是檢視頁，不是登入身分）。
- 登入流程：`handleLogin` → `completeLogin` → `applyPermissions`。
  最高管理員密碼寫死在 `handleLogin` 裡（測試腳本也用它登入）；一般社別密碼存在 `appAuthData.clubPasswords`，首次登入走「註冊」分頁自行設定。
- 預設密碼（2026-11-12）：地區設定檔可填 `defaultClubPassword`（3521 為 `111111`，3523 未設定＝維持註冊流程）→ `DEFAULT_CLUB_PASSWORD`。有設定時：尚未自行改密碼的社用它登入、登入畫面隱藏「首次進入 (註冊)」分頁（`applyDefaultPasswordUI`）；執秘快捷列 `#changePasswordBtn` → `changeMyClubPassword()`（prompt 驗證舊密碼、輸入兩次新密碼）；最高管理員「重置密碼」＝刪除該社紀錄＝恢復預設密碼。
- **角色是依「目前所在的大類與子活動」動態算出來的**：`applyPermissions` 檢查
  `eventChairs[catId]`（整個大類的主委）或 `eventChairs["catId::子活動名稱"]`（單一子活動的主委）。
  切換大類或子活動後要重新呼叫 `applyPermissions()`，否則權限不會更新。
- 報名表畫面 `viewSecretary` 對所有登入身分都顯示（主委社本身也要幫自己社報名）；`viewChair` 只在 chair/super_admin 顯示。
- 權限判斷的慣用寫法是 `currentRole === 'chair' || currentRole === 'super_admin'`，新增主委功能時沿用。
- 例外：主選單與子活動的新增/刪除（`chairCategoryActions`、`navAddSubEventBtn`、`navDeleteSubEventBtn` 與對應 `open*/handle*` 函式）只開放 `currentRole === 'super_admin'`，活動主委也看不到；顯示邏輯在 `updateRolePermissionsUI` 與 `renderNavTabs` 兩處，`changeSubEvent` 重算角色後會再呼叫 `updateRolePermissionsUI()`。

### 活動類型切換邏輯

- `isCurrentEventSports()` / `isCurrentEventGolf()`：運動賽事顯示差點欄位與參賽/用餐費用，高爾夫另有平均差點計算。
- 「地辦分攤金」類活動是以**名稱**判斷，不是用 id：大類名稱或**目前選到的子活動**名稱包含 `分攤金` 或 `配合款` 即視為分攤金模式（判斷式在 `applyCurrentEventMode`、`updateTotalFeeSummaryDisplay`、`submitRegistration` 各出現一次，修改時要三處一起改）。只看「目前子活動」是刻意的：地區年會底下同時有「大會」「晚宴」與「年會分攤金」，若看整個大類會把大會、晚宴也誤判成分攤金而隱藏報名表。`applyCurrentEventMode()` 在 `loadCategoryView` 與 `changeSubEvent` 都會呼叫，切換子活動時模式會重算。
- `DEFAULT_CATEGORIES`（全新資料庫的初始主選單）含「地辦分攤金/配合款」「社慶」與年會的「3.地區年會分攤金」（2026-11-12 補上，比照 3523 後台手動新增的內容；3523 既有資料的 id 是 `custom_…`，不受影響）。社慶模式同樣以名稱含「社慶」判斷，每個社慶是一個子活動、主辦社指派為該子活動主委。
- 分攤金模式的主委後台多一張「各分區繳款達成率」面板（`#apportionChartSection`，`renderApportionChart()`，由 `renderDivisionPaymentSection()` 開頭呼叫，所以繳費表任何異動都會同步）：純 HTML/CSS 橫條（不用 Chart.js），每分區一列＝已繳社數比例＋未繳社名；主委與最高管理員在 `data-mode === 'apportionment'` 時顯示；HTML 放在 `#viewSecretary` **上方**（不在 `viewChair` 裡），因為主委後台排在執秘報名表下面、要捲很遠才看得到。繳費總表同樣開放給最高管理員。統計由 `computeApportionStats()` 產生，畫面與 PDF 共用。「匯出 PDF」`exportApportionChartPDF()`：`buildApportionReportHTML()` 組一張 1123×794px（A4 橫式）全 inline style 的報表 → 懶載入 cdnjs 的 html2canvas 1.4.1 轉圖 → jsPDF 2.5.1 存檔（轉圖是因為 jsPDF 沒有中文字型；超過一頁高會等比例縮成單頁）。**html2canvas 畫的文字比瀏覽器低約 4–5px**，報表裡色塊的 `top:5px` 與標籤不對稱 padding 是在補償，改版面後要實際匯出看圖。面板加 `data-panel-default="open"` 表示使用者沒動過時預設展開（`initCollapsiblePanels`）。
- **社長當選人研討會（PELS）模式**（2026-11-13）：`isPelsMode()`＝目前子活動名稱符合 `/PELS|社長當選人/`。不用 `feeApportionment`，改四種出席方式 `PELS_OPTIONS`（SHARED／FAMILY／SINGLE／ABSENT，費用存 `subEventFees[key].feePels*`，`getPelsFee()`）；每位報名者的 `item.pelsOption`、`pelsLeaveReason` 存在訂單 item，`getMemberFee()` 在 PELS 模式回傳該方式的費用，訂單 `grandTotal`＝人頭加總、`apportionmentFee`＝0。凡是寫 `isSeminar`／`showFee` 的地方都要記得 PELS 是例外（`updateTotalFeeSummaryDisplay`、`submitRegistrationInner`、`renderSelectedMembersTable`）；繳費表應繳金額走 `getClubRequiredAmount(club)`。四種費用全為 0（`isPelsFeeConfigured()` 為 false）時鎖報名：`renderPelsDetailBox` 顯示提示、`submitRegistrationInner` 擋下、主委端 `#pelsFeeUnsetHint` 提醒。
- **旅平險個資絕對不可進 `app_storage`**（anon 可讀＝公開）：身分證字號／民國生日／手機只在 `pelsPrivateDraft`（記憶體）暫存，送出時 `savePelsInsurance()` 呼叫 RPC `save_insured_persons` 寫入 `insured_persons` 表（RLS 開啟、無 policy、anon 無任何權限；SQL 在 `supabase/sql/insured_persons.sql`），訂單 item 只留 `insuranceFilled`／`insuranceFamilyFilled` 旗標。主委端 `renderPelsInsuranceSection()`（面板 `#pelsInsuranceSection`）以「個資檢視密碼」呼叫 `read_insured_persons`／`delete_insured_persons`；密碼只以 bcrypt 雜湊存在 `app_secrets`，由 `set_pii_view_password` 設定，**不可寫進前端程式**（最高管理員密碼就是寫在前端所以不能拿來保護個資）。寫入函式沒有驗證身分（與整個系統一樣），有心人可覆蓋或刪除資料但讀不到。
- `cat.allowSponsors` 控制贊助社/協辦社區塊；`cat.allowAddSubEvents === false`（RYLA、End Polio）則隱藏子活動增刪按鈕。

### 社友名單的顯示順序（2026-11-17）

規則寫在 `checkin-core.js` 的 `CheckinCore.sortMembers`（另有 `memberRoleRank`、`compareMembers`、`isSpouseMember`），index.html 的 `sortMembersForDisplay()`／`memberRoleRank()` 只是轉呼叫：P（現任社長）→ S（現任秘書）→ 其餘依 Nick Name（**去掉開頭的扶輪職稱**，例如「PP Fred」以 Fred 排，職稱清單 `MEMBER_TITLE_RE` 與貼上接龍的 `RELAY_TITLE_RE` 相同再加 S；沒有就用姓名；`Intl.Collator` 不分大小寫、數字自然排序；同為 P 或 S 時也依 Nick Name），寶(尊)眷緊接在對應社友（`spouseOfId`）下方，找不到對應社友的放最後。**P／S 的判斷看兩處**：職務欄是 P／S／`社長`／`秘書`，或 **Nick Name 開頭是「P 」「S 」**（3523 實際名單的寫法是 Nick Name「P Robert」「S Three M」、職務欄寫「社長」「社友」，2026-11-17 使用者回報 S 沒排第二才發現）；比對前全形轉半形、轉大寫，`PP`、`PE`、`IPP`、`執秘`、沒有空格的「Sherry」都不算。**只影響畫面、不改 `clubMemberDatabase` 的存檔順序**（表格操作都用 `m.id`，所以安全）。套用在：社友庫表格（含搜尋結果）、`calendar-desk.js` 的 `cdOrderedMembers()`（代為登記、記錄實際出席、例會統計與 Excel）、LINE 綁定選名字（`line-checkin` 的 `members` 動作在雲端排好，所以改了 checkin-core.js 要複製到小程式資料夾並重新部署）。測試：`deno run --no-check --node-modules-dir=none -A supabase/tests/member_sort.ts`、`node check_member_sort.js`（需 8000 埠）。

### 社友職務選單可自行輸入（2026-11-19）

「今年扶輪職務」`#mRole` 內建選項不再擴充（使用者要求：地區職務太多，選單太長不好找），最後一項 `__custom__`（`MEMBER_ROLE_CUSTOM`）＝「其他職務（自行輸入）」，顯示 `#mRoleCustom` 文字框。讀寫一律走 `setMemberRoleInput(role)`／`getMemberRoleInput()`（不在內建選項的職務自動視為自填，所以 Excel 匯入的特殊職務編輯時也不會被清空）；自填職務只存在 `member.role`，**不加入選單**，並去掉 `<>&"'` 等符號（職務在多處直接插入 innerHTML）。

### 社友改名後自動搬移紀錄（2026-11-20）

整個系統認人用「社名＋`姓名|Nick Name`」，社友每年換職稱（PE→P→PP、DGE→DG）Nick Name 就會變，舊名字底下的 LINE 綁定、行事曆身分、私人行程、出席紀錄會全部對不上（使用者把自己從 PP Fruit 改成 DG Fruit 後收不到推播才發現）。
- **自動**：`handleSaveNewMember()` 編輯社友時若姓名或 Nick Name 有變 → `renameMemberInSubmittedOrders()` 把**本社**已送出的報名表與贊助獎裡的名字改掉（只改名字、不動金額；報到名單與「已報名」才認得出同一人）→ 存檔 → `moveMemberRecordsAfterRename()` 呼叫雲端 `club_member_rename`（不等它，失敗只 alert 提醒補做，不影響名冊存檔）。社裡還有另一位同名同 Nick Name 的人就不搬。
- **手動補救**：「📱 LINE 綁定名單」裡，綁定的名字已不在社友庫的那一列會顯示警告與下拉選單（只列尚未綁定的社友，同姓名排最前）→ `remapLineMember()`。自動搬移失敗、或 Excel 整批匯入改名（匯入不會自動搬）都靠這個。
- **雲端** `club_member_rename`（`lib.ts`，社密碼把關，與綁定名單同一做法）：新名字要在社友庫、舊名字要**已不在**社友庫（所以不能把另一位現有社友的紀錄搬給自己），再呼叫資料庫函式 `member_rename_move`（`supabase/sql/member_rename.sql`，只開放 service_role、一筆交易）。兩個名字各自都綁了 LINE＝`MEMBER_RENAME_CONFLICT`。搬移範圍：`line_bindings`、`event_checkins`、`calendar_roles`、私人行程 `owner_key`、`calendar_ics`、`calendar_rsvp`（含 `guest_of` 與 `guest:<key>:n` 同行者）、`calendar_attendance`、`calendar_makeups`、`calendar_report_viewers`、`calendar_stat_viewers`、`calendar_settings.backup_notify`、`calendar_digest_log`；姓名有改時連同總監秘書的 `syncMark`／`secProxy` 標記。**新增以 person_key 認人的資料表時，要把它加進這個函式。** `event_archives`（歷屆備份）是歷史快照，不改。
- 測試：`deno run --no-check --node-modules-dir=none -A supabase/tests/member_rename.ts`（把關 7 項）、`node check_member_rename.js`（需 8000 埠，13 項）；資料庫函式在 3521 用「交易＋rollback」實測過。

### 社費推播（2026-11-20，規格 `社費.md`）

執秘用 LINE 把「每位社友自己的社費明細」推給他。**每人金額是個資，絕不可進 `app_storage`**；`club-dues.js` 的任何操作都不呼叫 `saveToStorage()`。
- **開放**：沿用行事曆後台 ④-2（`calendar_club_push` 有該社＝開放；同一個開關同時管活動提醒與社費推播，使用者已知並同意）。快捷列 `#clubDuesBtn` 預設隱藏，`duesRefreshButton()`（由 `updateRolePermissionsUI()` 呼叫，同一社 5 分鐘只問一次 `club_dues_status`）確認開放才顯示；雲端沒開放一律 `DUES_CLUB_OFF`。
- **身分**：社的登入密碼（`checkClubPassword`，用 `lineBindingsApi()` 呼叫）。**不設推播密碼、不限次數**（使用者決定；已知 `clubPasswords` 公開可讀的風險並接受）。只擋「60 秒內內容一模一樣」（`content_hash`，`DUES_DUPLICATE`）。
- **算法只有一份**：`checkin-core.js` 的 `duesNormalize`／`duesCompute`／`duesPlainText`／`duesMoney`（畫面小計與雲端實際推出去的相同；改了要 `cp` 到小程式資料夾並重新部署，index.html 的 `checkin-core.js?v=` 也要換）。表單＝`{info:{period,due,method,note}, common:[{name,amount}], members:{'姓名|Nick Name':{off:[共同品項序號], extra:[{name,amount}]}}}`；金額整數可負、0 或無名稱的品項不算；只列社友（寶尊眷不列）；**小計 0 不推**。
- **畫面**（`club-dues.js`，全域名稱 `dues*`，視窗 `#clubDuesOverlay` 動態建立）：畫面上的共同品項用 `id`、取消勾選存 id，`duesFormOut()` 才轉成序號（沒填完的列不算）。輸入框用 `oninput` 改資料、只重畫表格（`duesRenderTable`），不可整個重畫否則會打斷輸入。草稿存 localStorage `rotary_dues_draft::<社名>`（有改過 `dues.dirty` 才存；發送成功後清掉）；沒有草稿時帶出雲端的上次內容，個別品項標 `carried`（黃色「沿用上次」，按一下確認）。預覽與「複製明細文字」在前端算；未綁定名單來自 `club_dues_get` 的 `bound`（不回傳 LINE 使用者代碼）。
- **雲端**（`supabase/functions/line-checkin/dues.ts`，由 `lib.ts` 轉送）：`club_dues_status`／`club_dues_get`／`club_dues_send`。發送：重新用社友庫計算 → 一人一則 Flex 卡片（`buildDuesMessage`，只用官方帳號 token）→ 存 `club_dues_state`（每社一列＝上次內容）＋ `club_dues_log`（只記人數與總金額，不記每人明細）。兩張表在 `supabase/sql/club_dues.sql`，RLS 開啟、無 policy、anon 無權限。`member_rename_move` 會把 `club_dues_state` 裡的索引一起改名。
- 不做：Excel 匯入、PDF 附件、記錄是否已繳。
- 測試：`deno run --no-check --node-modules-dir=none -A supabase/tests/club_dues.ts`（18 項）、`node check_club_dues.js`（需 8000 埠，25 項）。

### 全球獎助金查詢（2026-11-21，規格 `讀取Rotary-Shared資料說明.md`）

查詢共用 Supabase 專案 **Rotary-Shared**（`ceqxbzctljutsbvdmgwv`，所有地區共用，由另一個爬蟲專案寫入）的 `global_grants`。**只讀不寫**；瀏覽器不直接連 Rotary-Shared，一律經過本地區的 `line-checkin`。
- **三道開關**：畫面＝地區設定檔 `grantsEnabled`（`ggInitButton()` 由 `initRagAssistantButton()` 呼叫，切換快捷列 `#globalGrantsBtn`）；真正把關＝雲端 secrets `ROTARY_SHARED_SUPABASE_URL`＋`ROTARY_SHARED_SUPABASE_SECRET_KEY` 都有值（`index.ts` 才建立 `deps.shared`，否則 `GRANTS_NOT_CONFIGURED`）；身分＝社的登入密碼（`lib.ts` 對所有 `grants_*` 先 `checkClubPassword`，前端用 `lineBindingsApi()`）。金鑰是 `sb_secret_`（可讀可寫全部資料，無法設唯讀），**絕不可出現在前端、設定檔或 git**；每個地區一把專屬金鑰，由使用者點 `設定全球獎助金金鑰.command` 輸入。
- **雲端** `supabase/functions/line-checkin/grants.ts`（`handleGrants`，只用 select）：`grants_list`（`withOptions` 時加回國家／區域選項、總數、`updatedAt`）、`grants_export`（完整欄位，一次 `EXPORT_PAGE`＝100 筆，`next` 不是 null 就再取）、`grants_related`（`district`＝主辦或國際夥伴地區，或 `pledges` 含 `{"地區": 代號}`；鍵名是中文）、`grants_get`。**篩選只有一份** `applyFilters()`，清單與匯出共用（畫面幾筆就匯出幾筆）；使用者輸入先過 `safeText()` 才進 `.or()`／`.ilike()`。清單不取長篇說明；排除 `removed_from_list` 非 null；「募款中」一律用 `remaining_amount > 0`。讀取失敗只回 `GRANTS_READ_FAILED`，紀錄只記錯誤代碼（原始訊息可能含網址或金鑰片段）。
- **畫面** `global-grants.js`（全域名稱 `gg*`，視窗 `#globalGrantsOverlay` 動態建立）：資料只放記憶體 `gg`（同一社 10 分鐘內重開沿用），**不可存 `localStorage`／`app_storage`，不呼叫 `saveToStorage()`**。篩選列（`ggRenderFilters`）與結果（`ggRenderResults`）分開畫，才不會打斷輸入；關鍵字停止輸入 0.5 秒才查，`gg.seq` 丟棄過期結果。外部文字一律 `ggE()`；Email 格式正常才做 `mailto:`（`ggMail`）、來源網址要 http(s) 開頭才做連結。服務重點下拉是固定的七大重點 `GG_FOCUS`（資料裡的中文名稱固定，名稱本身含頓號所以不能用頓號拆）。匯出 `ggExport()` 用已載入的 SheetJS，欄位 `GG_XLSX_COLS`（順序比照爬蟲的 Excel）、金額寫數字、認捐明細一筆一行、超過 32,000 字截斷；SheetJS 社群版寫不出凍結窗格，改加自動篩選。
- 沒做：地區自己的收藏／洽談備註（說明檔第 7 節 `grant_notes`）、一鍵寄信給所有聯絡人（要做前先問使用者）。
- 測試：`deno run --no-check --node-modules-dir=none -A supabase/tests/global_grants.ts`（假的 `deps.shared`，37 項）、`node check_grants.js`（需 8000 埠，37 項）。

### 刪除社友與已送出的報名表（2026-11-14）

已送出的報名表（`registrationOrders[子活動].items`）是送出當下的快照，**不會**隨社友庫變動；報到名單讀的是它。`deleteMember()` 會用 `findSubmittedRegistrationsOf()` 找出該社友（姓名＋Nick Name）在本社哪些報名表裡，**再問一次**要不要一併移除——不自動連動，因為社友離社後過去的紀錄通常要保留，而且會動到應繳金額。一併移除時：只有該張報名表「真的收人頭費」（`participantFee > 0` 且等於各人 `fee` 加總）才從 `participantFee`、`grandTotal` 扣掉他的 `fee`；**不可以直接加總 item.fee 重算**（研討會的 item 也帶著 `fee` 但不收費，會把金額算錯）。PELS 不自動移除（牽涉出席方式與旅平險個資），只提示。

### 貼上 LINE 接龍（2026-11-14）

社友庫右上角「💬 貼上 LINE 接龍」→ `#lineRelayModal`。`parseLineRelay(text, members)` 是純函式：逐行去掉編號後用 `relayNorm`（全形轉半形、小寫、去空白）比對社友的中文姓名／Nick Name／去掉扶輪職稱的 Nick Name（`relayNickBase`），長字串優先、英文要完整單字；回傳 `{matched, unmatched, skipped, ambiguous, notes}`。`applyLineRelay()` 只把人加進 `currentFormSelectedMembers`（欄位要與 `toggleMemberSelection` 新增時一致），**不會自動送出**。PELS 仍需逐人填出席方式與旅平險資料。

### 活動報到系統（2026-11-14，第一階段：櫃台點名）

規格與第二階段（LINE 自助報到）方向在 `報到.md`。
- **三個檔案**：`checkin-core.js`（`window.CheckinCore`：`buildRoster` → `mergeCheckins` → `computeStats`，人數只能用這一套算，不要在別處另寫）、`checkin.html`（櫃台頁，網址 `checkin.html?e=<encodeURIComponent(大類id::子活動名稱)>`）、`index.html` 的主委面板（`data-panel="checkin"`，`renderCheckinPanel()` 由 `updateRolePermissionsUI()` 呼叫，只用已抓到的 `checkinState` 重畫；換活動或 `refreshCheckinPanel()` 才連網，用 `checkinFetchSeq` 丟棄過期結果）。
- **資料表**（`supabase/sql/event_checkins.sql`，3521 已執行）：`checkin_events`（報到中與否、報到密碼 bcrypt；RLS 無 policy）與 `event_checkins`（一人一筆，anon 只能 SELECT）。寫入一律走 RPC：`checkin_set_event`／`checkin_verify`／`checkin_mark`／`checkin_cancel`／`checkin_reset`／`checkin_event_status`，要帶報到密碼且活動在「報到中」。取消報到只改 `status='cancelled'` 不刪列（其他櫃台才同步得到）。現場加報分「已到」（`checkin_mark`，`is_walk_in=true`）與「還沒到」（`checkin_add_walkin` → `status='pending'`；人到了再 `checkin_mark` 變 `in`，保留加報標記與備註；對已到的加報者 `checkin_cancel` 會變回 `pending`（名字留在名單，使用者要求）；從名單拿掉要用「刪除」＝`checkin_remove_walkin`）。**SQL 有更新時要先在資料庫重跑再部署前端**（新前端呼叫舊資料庫沒有的函式會顯示「尚未建立報到資料表」）。錯誤代碼 `CHECKIN_*` 由 `checkinErrorText()`／`errText()` 轉中文。
- **報到紀錄不可放進 `app_storage`**（整包覆寫，多櫃台會互蓋）。**`checkin.html` 絕不寫 `app_storage`**；主委面板的任何操作也不可呼叫 `saveToStorage()`。面板裡不要放 `<input>`（會讓 `liveSyncUserIsEditing()` 暫停即時同步重畫）。
- **認人用 `person_key`＝`姓名|Nick Name`**（同一社內），不用社友 id（匯入 Excel 會整批重編）。
- **應到名單規則**：來源是 `registrationOrders[子活動名稱]` 的 `items`；PELS 的 `ABSENT` 不列入、`FAMILY` 只點本人（眷屬是受保護個資）；運動賽事另加贊助獎用餐來賓；「參賽／只用餐」標籤只有運動賽事顯示（其他活動的 item 也帶預設值「參賽」）；分攤金／配合款不提供報到（`CheckinCore.isApportionEvent`，判斷式與 `applyCurrentEventMode` 相同）。
- **兩個 Realtime 廣播頻道**：`rotary-checkin`（payload `{key, kind}`，kind＝`mark`／`cancel`／`status`／`reset`；主委面板與所有櫃台都訂閱）與既有的 `rotary-live-sync`（櫃台頁收到後重讀應到名單）。備援：櫃台每 8 秒抓變動（順便 `checkin_verify`，主委換密碼後舊密碼的櫃台會被退回輸入畫面）、每 2 分鐘整批重抓；主委面板展開時每 20 秒抓一次。報到紀錄讀取要 `.range()` 分頁（一次上限 1000 筆）。
- 統計欄位：`expected`＝應到、`arrived`＝名單內已到、`extra`＝現場加報已到、`extraPending`＝加報未到、`walkTotal`＝兩者合計、`present`＝`arrived+extra`、`absent`＝`expected−arrived+extraPending`（恆等式：應到＋加報＝實到＋未到）。**畫面與 Excel 的「實到」一律顯示 `present`**（使用者要求與現場人數一致），未到顯示 `absent`、出席率＝`arrived÷expected`。各社 `people[]` 是整張名單（含加報），統計分頁以紅色標示已報到（使用者指定的顏色）。
- 報到密碼記在 localStorage `rotary_checkin_pw::<活動key>`，主委面板與報到頁共用（同一台裝置主委開報到頁免輸入）。
- 測試：內嵌 script 抽出來 `node -c`；資料庫與瀏覽器實測先在 3521 展示站做，測完清空 `event_checkins`／`checkin_events` 的測試列。`.vercelignore` 的 `check_*.js` 不會排除 `checkin-core.js`（沒有底線），改排除規則時要留意。

### LINE 自助報到（2026-11-14，第二階段）

- **啟用條件**：地區設定檔 `lineLiffId`（→ `LINE_LIFF_ID`）有值才出現：主委面板的「社友 LINE 自助報到 QR Code」（`getLineCheckinUrl()`＝`https://liff.line.me/<LIFF ID>?e=<活動key>`，`checkinDownloadLineQr()` 產生列印用 PNG）與社友庫的「📱 LINE 綁定名單」（`#lineBindingsBtn` → `#lineBindingsModal`）。3521、3523 目前都是空字串＝未啟用。
- **`line.html`**：`liff.init` → `liff.getIDToken()` → 呼叫雲端小程式。沒帶 `?e=` 是綁定／查看綁定；帶 `?e=` 是報到。**只送 idToken，絕不把 LINE 使用者代碼當身分**。
- **雲端小程式 `supabase/functions/line-checkin/`**（`--no-verify-jwt`）：`index.ts` 接上真正的 LINE 驗證（POST `https://api.line.me/oauth2/v2.1/verify`，`client_id`＝secret `LINE_LOGIN_CHANNEL_ID`）與資料庫；邏輯全在 `lib.ts` 的 `handle(body, deps)`，`deps.verify` 可替換，所以本機測試用假的驗證跑同一份邏輯。動作：`init`／`members`／`bind`／`unbind_self`／`checkin`（需 idToken）、`club_bindings`／`club_unbind`（執秘，用社的登入密碼；沒設密碼的社用 secret `DEFAULT_CLUB_PASSWORD`）。錯誤一律回 HTTP 200 的 `{ok:false, code}`，前端轉中文。
- **`supabase/functions/line-checkin/checkin-core.js` 是根目錄 `checkin-core.js` 的複本**（小程式只能打包自己資料夾裡的檔案）。**改了根目錄那份一定要 `cp` 過去並重新部署小程式**，否則 LINE 報到與櫃台的應到名單會不一致。
- **資料表**（`supabase/sql/line_bindings.sql`，要先跑過 `event_checkins.sql`）：`line_bindings`（`line_user_id` 主鍵、`unique(club_name, person_key)`；RLS 無 policy，anon 完全讀不到，比照旅平險個資）；函式 `line_checkin_mark` 只開放 `service_role`，寫入 `event_checkins` 時 `method='line'`、`checked_by='LINE 自助'`（代家人報到為 `LINE（某某 代）`）。
- **規則**：只能綁社友庫裡的人；一個 LINE 只能綁一個名字、一個名字只能被一個 LINE 綁；報到要活動在「報到中」；本人要在 `buildRoster` 的名單內，或櫃台已幫他現場加報（pending）；同行者只限社友庫裡互為寶(尊)眷（`spouseOfId`）且也在名單上的人，前端送來的其他 key 會被忽略；報到後小程式用 Realtime REST 廣播 `rotary-checkin` 通知櫃台。
- 不做防代點（不做動態 QR Code、GPS），使用者已決定。
- **加好友提醒（2026-11-19）**：地區設定檔 `lineOfficialId`（官方帳號 ID，3521＝`@007eapij`、3523＝`@628ouczd`）。`line.html` 的 `checkFriend()` 用 `liff.getFriendship()` 問 LINE 這個人加好友了沒，沒加就顯示 `#friendBar`（「加入好友」連到 `https://line.me/R/ti/p/@id`），切回頁面時重查。**前提**：LINE Developers 的 LINE Login 頻道要設定「Linked LINE Official Account」（另可把 LIFF 的 Add friend option 設為 On (Aggressive)，第一次同意時順便加好友）；沒連結時 `getFriendship` 會丟錯，程式靜默略過、不顯示提醒。

### LINE 推播提醒（2026-11-14）

主委對「已報名且已綁定 LINE」的社友發送提醒，**逐一地區由系統管理者（Fruit）開放**，預設關閉。
- **兩道開關**：畫面＝地區設定檔 `linePushEnabled`（且要有 `lineLiffId`）→ `LINE_PUSH_ENABLED`，面板 `data-panel="linePush"`；真正把關在雲端小程式：secret `LINE_MESSAGING_ACCESS_TOKEN`（官方帳號 Messaging API 的 token）與 `LINE_PUSH_PASSWORD` **都有值**才算開放，且每次操作都要帶對的推播密碼（錯誤故意延遲 1 秒）。3521（官方帳號 `@007eapij`）與 3523（`@628ouczd`，2026-11-14 開放）都已開放。**不要改成用社的登入密碼把關**：`clubPasswords` 在 `app_storage` 是公開可讀的，推播會花錢又會打擾社友。
- **動作**（都在 `line-checkin` 的 `lib.ts`，`deps.push` 可替換成假的發送器做測試）：`push_status`、`push_preview`（人數、未綁定名單、本月用量）、`push_send`、`push_history`。對象由伺服器用 `CheckinCore.buildRoster` → `mergeCheckins` 算出（只含報名名單上的人，現場加報不算），再用 `line_bindings` 找出 LINE 使用者代碼；**前端只送篩選條件（社名清單、狀態、參加方式），不送名單也不送使用者代碼**。訊息含 `{姓名}`／`{社名}` 時一人一則（8 個一批），否則用 multicast（一次最多 500 人）。同活動 60 秒內相同訊息會擋下（`PUSH_DUPLICATE`）。另一種對象 `filter.audience === 'all_friends'`＝官方帳號所有好友（LINE broadcast，不看報名與綁定；不可含 `{姓名}`／`{社名}`→`PUSH_NO_PERSONAL`；好友人數取自 LINE insight API 前一天的統計，新帳號查不到時為 null，畫面要能處理）。每次發送寫一筆 `line_push_log`（`supabase/sql/line_push.sql`，anon 讀不到）。
- **面板有輸入框，所以不跟著 `updateRolePermissionsUI()` 重畫內容**：`renderLinePushPanel()` 只切換顯示，`linePushKey` 變了（換活動）才重設對象清單與預設訊息。條件一改就 `linePushInvalidate()`，要重新預覽才能按發送；推播密碼只放記憶體（`linePushPassword`），不進 localStorage。面板的任何操作都不呼叫 `saveToStorage()`。
- 限制：社友要把官方帳號加為好友才收得到，系統無法得知誰沒加；官方帳號的 Messaging API 頻道要與 LINE Login 頻道在同一個 Provider（使用者代碼才相同）。

### 扶輪行事曆（2026-11-16，階段 1：基礎行事曆）

規格在 `行事曆.md`（原規格寫 Next.js，**已決定改沿用現有架構**，不另開專案）。分階段：1 基礎（已做）→ 2 Excel 匯入＋一鍵加入私人行事曆 → 3 「我要參加」串接報名 → 4 總監每日推播＋代理人。
- **進入點**：社友在 LINE 開 `https://liff.line.me/<LIFF ID>?p=calendar` → `line.html?p=calendar`（LIFF 只能指到一頁，所以行事曆放在 `line.html` 裡，畫面與邏輯在 `calendar.js`）。未綁定 LINE 身分的人會先走綁定流程。電腦版後台 `admin-calendar.html`（指派管理者、活動類型）。
- **資料表**（`supabase/sql/calendar.sql`，**要先在 Supabase 執行才能用**）：`calendar_event_types`、`calendar_roles`、`calendar_events`，RLS 開啟、無 policy、anon 完全讀不到（私人行程才不會外洩）。**行程不放進 `app_storage`**（整包覆寫會互蓋）。認人同 LINE 報到：社名＋`姓名|Nick Name`，不用 uuid；原規格的 `members`／`clubs` 表不建立。
- **後端**：`supabase/functions/line-checkin/calendar.ts`，由 `lib.ts` 的 `handle()` 轉送 `cal_*` 動作。社友動作先向 LINE 驗證 idToken、查 `line_bindings` 找出是誰，再依 `calendar_roles` 判斷權限（`canWrite()` 集中判斷：地區＝district_editor、社內＝managed_club 相符的 club_editor、私人＝本人）。`cal_admin_*` 用 secret `CALENDAR_ADMIN_PASSWORD` 把關（沒設＝後台關閉；**不要用最高管理員密碼**，它寫在前端）。錯誤碼 `CAL_*`，前端 `CAL_ERR` 轉中文。
- 時間一律存 timestamptz、前後端都用台灣時間（UTC+8）計算；全天行程 `end_at` 為當天 23:59；沒填結束時間＝開始時間。取消行程只改 `status='cancelled'`。列表查詢用「地區＋本社＋本人私人」三次查詢合併（不用 `.or()` 字串，避免社名符號弄壞查詢）。
- **手機行事曆訂閱（.ics，6.9）**：LINE 行事曆右上 ⚙️ → 開關／複製網址／重新產生（動作 `cal_ics_status`／`cal_ics_set`／`cal_ics_rotate`）。表 `calendar_ics`（每人一組隨機 token，`enabled=false` 或重新產生後舊網址立即失效；anon 讀不到）。公開網址＝`<supabaseUrl>/functions/v1/line-checkin?ics=<token>`（`index.ts` 的 GET 分支 → `icsFeed()`，回 `text/calendar`，不帶登入，靠 token 認人）。內容＝地區＋本社＋本人私人，今天前 30 天～未來 365 天，已取消的行程標 `STATUS:CANCELLED`。**token 等同密碼，private 行程在內**，畫面有警告。預設畫面已改為「所有行程＋今天」。尚未在真實 iPhone／Google 日曆驗證過，部署後要實測（含 Supabase 是否原樣回傳 `text/calendar`）。
- **報名系統裡的「🗓️ 行事曆管理」（A＋B）**：地區設定檔 `calendarEnabled: true`（→ `DISTRICT.calendarEnabled`）才顯示；3523 與 3521 都已開（3521 於 2026-11-19 開啟：calendar.sql、小程式、排程都已部署；3521 站仍是 CLI 部署，見記憶）。入口＝執秘快捷列 `#calendarDeskBtn`、最高管理員頁頂端 `#calendarDeskCard`（`initRagAssistantButton()` 內切換）→ `openCalendarDesk()`。畫面與邏輯在 `calendar-desk.js`（全域名稱以 `cdesk`／`cd` 開頭，`var cdeskAdminPw` 必須是 var 才會掛在 window，供嵌入的 `admin-calendar.html` 共用密碼）。三個分頁：本社行程、地區行程、（最高管理員）管理者與活動類型＝iframe 嵌入 `admin-calendar.html` 並顯示貼圖文選單用的 LIFF 網址。後端動作 `cal_desk_*`（`calendar.ts` 的 `handleDesk`）：**認證二擇一**——`adminPassword`（可管地區與任何社）或 `club`＋`clubPassword`（只能管自己那社，密碼取自 `appAuthData.clubPasswords`／`DEFAULT_CLUB_PASSWORD`，與 LINE 綁定名單同一做法；**`clubPasswords` 在 app_storage 是公開可讀，所以社內行程的保護強度只有這樣**，地區行程因此要求後台密碼）。**私人行程在 desk 一律不可碰**（`can()` 對 private 恒為 false）。寫入同樣不碰 `app_storage`。
- **社內已報名名單與「我要參加」（階段 3 的一部分，2026-11-16）**：行程可在「行事曆管理」表單的「對應報名活動」下拉選單選一個報名活動（`calendar_events.registration_key`＝`大類id::子活動名稱`，分攤金／配合款不列）。有對應的地區／社內行程，LINE 詳細頁（`calendar.js` 的 `calLoadReg`／`calRsvp`）顯示**本社**誰已報名（✅ 正式報名＝`CheckinCore.buildRoster` 算出的該社名單，與報到、推播同一套算法）與誰按了「我要參加」（🙋 意願）；**別社的人看不到**。社友按「我要參加」只寫 `calendar_rsvp`（意願，**不寫 `app_storage`**，避免整包覆寫互蓋），正式報名仍由執秘送出；已正式報名者不能自己取消（`CAL_RSVP_LOCKED`）、行程取消後不能再按。動作：`cal_rsvp_status`／`cal_rsvp_set`（LINE，`handleMember` 的第 5 個參數 `reg.roster` 由 `lib.ts` 提供）、`cal_desk_rsvp`（執秘讀本社意願名單）。執秘端：報名表上方 `#calRsvpBox`（`calendar-desk.js` 的 `renderCalRsvpBox()`，由 `renderSelectedMembersTable()` 呼叫，只用快取畫、30 秒過期才連網；請求以「這一次」物件為準，切換活動時舊結果不採用）列出「尚未進報名表」的人，可一鍵加入目前報名表（欄位與 `toggleMemberSelection` 一致，**不自動送出**）。LINE 詳細頁停留時每 10 秒自動重讀報名名單（`calRegPoll`，只在 LINE 在前景、仍停在該行程詳細頁時進行，名單簽章 `calRegSig` 沒變就不重畫，失敗靜默；切回前景立刻更新；離開詳細頁自動停止）。LINE 手機版編輯行程不帶 `registrationKey` 時不會清掉既有對應（`normalizeEvent` 只在有帶這個欄位時才處理）。
- **活動日期 → 行事曆連動（2026-11-16）**：主委後台「活動設定與費用金額」多了 📅 活動日期、開始時間、結束時間（`#cfgEventDate`／`#cfgEventStart`／`#cfgEventEnd`，分攤金／配合款隱藏）。存在 `chairConfig.eventDates["大類id::子活動名稱"]＝{date,start,end}`（刻意不放 `subEventFees`：那裡只認數字，且它一變動會觸發其他裝置重畫報名表；`loadFromStorage` 有補預設值）。`saveChairSettings()` 存檔後呼叫 `syncEventDateToCalendar()`（`calendar-desk.js`）→ 雲端 `cal_desk_sync`：用該活動 key 找地區行程，**沒有就建立**（標題＝子活動名稱、`registration_key`＝該活動，所以社友在 LINE 立刻有「我要參加」；沒填開始時間＝全天），**有就只更新日期時間**（管理者改過的標題、地點不覆蓋），日期清空＝只移除「自動建立」的那筆（以 `created_by === AUTO_SYNC_MARK`「主委活動設定（自動連動）」辨識，手動建立的行程不會被刪）。認證：最高管理員＝行事曆後台密碼（沒輸入過會 prompt 一次）；主委＝本社登入密碼，且雲端用 `appAuthData.eventChairs`（大類 id 或「大類id::子活動名稱」）確認該社真的是這個活動的主委（`isChair`）。從沒填過日期的活動存檔時不連網。已知限制：重新命名子活動會改變 key（舊行程變孤兒，與其他以名稱為 key 的資料一致）；日期以主委設定為準，行事曆管理者在行事曆裡改日期、下次主委存檔會被改回主委設定的日期。
- **「私人」頁顯示我參加的活動 + 「二週」（2026-11-16）**：`cal_list` 每筆行程多一個 `joined`（`registered`＝執秘已正式報名，由 `CheckinCore.buildRoster` 算、每個對應活動只算一次且同一請求只讀一次 `app_storage`；`interested`＝我按了「我要參加」；正式報名優先）。前端 `calVisible()`：私人頁＝本人私人行程＋`joined` 的地區／社內行程，標 🔗、保留原層級顏色，卡片上也有「✅ 已報名／🙋 已表示參加」標記（所有頁都有）。`calBack()` 返回時會重畫列表（不連網），所以在詳細頁按「我要參加」後列表立刻反映。範圍列為 今天／三天／本週／二週／本月（`range: 'two'`＝本週一起算連續 14 天，按 ‹ › 一次翻兩週；`calLoadPrefs` 白名單已含 `two`）。
- **社內例會「開放參加」＋寶尊眷（2026-11-16）**：行程新增 `calendar_events.rsvp_enabled`（「開放社友按我要參加」，社內例會等**不走報名系統**的活動用；新增社內行程預設勾選，電腦版「行事曆管理」與手機版表單都有這個勾選，私人行程不可開）。能按「我要參加」＝有對應報名活動（`roster.ok`）**或** `rsvp_enabled`。`calendar_rsvp` 多了 `guest_of`（這筆是誰帶的寶尊眷，本人為空字串）與 `guest_role`。**寶尊眷＝社友庫裡互為寶(尊)眷的人**（`lib.ts` 的 `familyKeys`，與 LINE 報到同行家人同一規則；`reg.family`），`cal_rsvp_status` 回傳 `family`（供勾選）與 `myGuests`；`cal_rsvp_set` 的 `guestKeys` 代表「我帶的寶尊眷＝勾選的這些」（多退少補，只接受家人名單內的人、已被執秘正式報名或已登記的不重複登記），取消參加會連同我帶的寶尊眷一起取消；寶尊眷本人（若有綁 LINE）也會看到自己在名單內。**自動更新（`poll:true`）不讀家人名單**（讀家人要載入整包社友庫，很大）；前端 `calFamily` 沿用第一次讀到的，`calGuestSel` 保存使用者正在勾的選項，避免自動更新洗掉。電腦版行程列表顯示「🙋 表示參加 N 人（含寶尊眷）」，`cal_desk_event_rsvp` 看名單並可複製貼 LINE（社內行程＝該社；地區行程需後台密碼，各社合併）。人數＝本人＋寶尊眷各算一人。**SQL 需重跑**（新增兩個 alter column）。
- **例會實際出席與統計（2026-11-17）**：新表 `calendar_attendance`（行程×社×人一筆，`is_guest`＝寶尊眷；**SQL 需重跑**）。「表示參加」＝社友在 LINE 自己按的意願（`calendar_rsvp`）；「實際出席」＝執秘在「🗓️ 行事曆管理」勾選後儲存（`cal_desk_attend_get`／`cal_desk_attend_save`，只限**社內行程**，地區活動出席請用報到系統；儲存＝整批取代，只收該社社友庫裡的人，`DeskCtx.members` 由 `lib.ts` 提供）。尚未記錄過的場次，勾選畫面預設帶入「表示參加」的人。勾選畫面分兩組（使用者要求，社友多時好點選）：上組 `#cdAttG1`＝有報名（LINE 自己登記＋執秘代登記，標示方式）以及已記錄為出席的人；下組 `#cdAttG2`＝其他社友（臨時出席時勾選）；各組有「本組全選／清除」（`cdAttendGroup`）。分頁「📊 例會統計」（`cdeskRenderStats`）：期間＝本扶輪年度（7/1～6/30，預設）／上個扶輪年度／本月／上個月／自訂（最長約一年）；雲端 `cal_desk_stats` 只回傳每場的名單（社內行程中開放參加、有人表示參加或已記錄出席者，已取消不算），**彙整在前端**（`cdStatsCompute`：社友庫所有人都列出含 0 次，已離社但有紀錄的人標「已不在社友庫」）。出席率＝實際出席次數 ÷ 期間內「已記錄出席」的場數（未記錄的場次不列入分母）。匯出 Excel（`cdStatsExport`，用 index.html 已載入的 SheetJS）三個工作表：每位社友統計、各次例會、出席明細（人×場次矩陣，標「出席／表示參加」）。
- **代登記：貼上 LINE 接龍＋同行的非社友（2026-11-17）**：「代為登記參加」畫面有「💬 貼上 LINE 接龍」→ `cdPxRelayPlan(text, 社友庫)`（用 index.html 的 `parseLineRelay` 找社友，再以 `cdRelayExtraCount(line)` 判斷帶幾位：`+N`＝N、`3位`＝2、`兩位`／`夫婦`／`+夫人`＝1，行首編號不算）。第 1 位＝該社友在社友庫的寶尊眷（直接勾），沒有就加一個「寶(尊)眷」同行者欄位讓執秘填名字；第 2 位起＝同行者、身分留空要從下拉選單選（`CD_GUEST_TYPES`＝寶(尊)眷／子女／外勞／朋友／其他）。套用只勾選＋加欄位，重貼同一份不會重複，**不自動儲存**。同行者存在 `cdPx.guests`＝`[{host,type,name}]`，也可手動「＋ 新增同行者」（帶人的社友自動勾選）；存檔時身分沒選、或帶人的社友沒參加都會擋下。雲端 `cal_desk_proxy_save` 的 `guests`：寫成 `calendar_rsvp` 的列，`person_key`＝`guest:<帶他的社友 key>:<序號>`（`isExtGuestKey`）、`guest_of`＝帶他的社友、`guest_role`＝身分、`proxy_by`＝執秘；整批取代執秘代登記的同行者，帶人的社友不在社友庫或沒參加、身分不在白名單都忽略；名字空白時存「Nick Name的身分」。**沒送 `guests`（舊版畫面）時不動既有同行者**。社友在 LINE 的 `myGuests` 不含執秘代登記的列（改寶尊眷不會刪掉執秘加的子女），但社友自己按「取消參加」會連同帶的人（含執秘加的）一起取消。實際出席：`cal_desk_attend_save` 也接受這場的同行者 key（`is_guest`＝true），出席頁把同行者插在帶他的社友下方、標「（非社友）」；例會統計不列同行者個人、只算進「+N 寶尊眷與同行者」。LINE 與電腦版名單顯示身分（子女、外勞…）。
- **所有行程預設開放參加（2026-11-17，使用者要求）**：電腦版與手機版新增地區／社內行程時「開放社友按我要參加」預設勾選（不限例會，運動賽事、研討會等都一樣），`cal_desk_sync` 自動建立的行程也帶 `rsvp_enabled: true`；私人行程沒有此選項。資料表欄位預設值仍是 false（私人行程寫入時會刪掉這個欄位，靠預設值維持 false），所以**新的寫入路徑要自己帶 true**。現有行程用一次性的 `supabase/sql/calendar_rsvp_all_on.sql` 打開（不可放進 calendar.sql：重跑會把管理者刻意關掉的又打開）。注意：例會統計會列出所有開放參加的社內行程（不只例會）。
- **執秘代為登記參加（2026-11-17）**：`calendar_rsvp.proxy_by`（執秘代登記時＝`報名系統（社名）`／`報名系統（後台）`，社友自己按的為空字串；**SQL 需重跑**，而且**要先跑 SQL 再部署小程式**，否則 `rsvpStatus` 選取不存在的欄位會讓 LINE 名單壞掉）。動作 `cal_desk_proxy_get`／`cal_desk_proxy_save`：只限社內行程且 `rsvp_enabled` 或有 `registration_key`（否則 `CAL_REG_UNAVAILABLE`），已取消不能存（`CAL_EVENT_CANCELLED`）；`keys`＝「執秘代登記」的人（只收社友庫裡的人），只增刪 `proxy_by` 非空的列，**社友自己登記的列不會被動到**。寶尊眷代登記時 `guest_of` 為空、`guest_role` 填職務，所以「是不是寶尊眷」一律用 `rsvpIsGuest()`（`guest_of || guest_role`）。LINE 名單 `people[].proxy` 顯示「（執秘代登記）」；家人選項 `listed`＝已在名單但不是我帶的（顯示「已登記」、不能勾）。前端 `cdeskProxy`／`cdeskProxySave`（`.cd-px` 可勾、`.cd-pxself` 為本人登記鎖住）。
- **出席率（例會＋地區活動補出席，2026-11-17）**：雲端 `attendanceReport(admin, club, periods, members, onlyKey?)`（`calendar.ts`）是唯一的算法，三個入口共用：LINE `cal_attend_report`（`scope:'me'` 只回本人；`scope:'club'` 限「可看全社」的人＝`canViewClubReport(m, loadReportViewers(社))`：該社在表 `calendar_report_viewers`（一社一列、`viewers` jsonb＝`姓名|Nick Name` 陣列，anon 讀不到）有設定就只認勾選的人，沒有這一列＝預設社長 P／秘書 S（`memberRank()`≤1，與排序同一套）；資料表還沒建立時當作沒設定。`reg.members` 由 `lib.ts` 提供；回傳 `canClub`）、報名系統 `cal_desk_attend_report`（執秘本社／後台指定社）。`periods`＝最多 3 段 `{id,from,to}`，前端送扶輪年度的上半年 `h1`（7/1～12/31）與全年 `year`（7/1～6/30）。例會＝本社社內行程（未取消，且開放參加或有出席／參加紀錄），**只有已記錄出席的場次列入分母**；補出席＝地區活動報到（`event_checkins` 本社、`status='in'`、`checked_in_at` 在期間內，每個活動算一次，日期取最早報到時間，自動）＋**執秘手動登記**（表 `calendar_makeups`：`made_on` 台灣日期、`kind`＝友社例會／地區活動／其他、`note`；動作 `cal_desk_makeup_add`（只收社友庫裡的人）／`cal_desk_makeup_delete`（只能刪自己社的）；**SQL 需重跑**，且要先跑 SQL 再部署小程式，否則報表查不到這張表會整個失敗）。每人每段 `{held, attended, district, manual, makeup=district+manual, effective=attended+makeup, rate=effective/held, meetRate=attended/held}`，`held=0` 時 rate 為 null。**出席率可以超過 100%**（使用者明確要求：分母固定是本社已記錄例會場數，分子＝例會出席＋補出席，不設上限）。**誰能看全社由行事曆後台逐社設定**（使用者要求：預設社長、秘書，但各社文化不同）：`admin-calendar.html` 的「③ 誰可以在 LINE 看全社出席率」選社 → 勾選社友 → 儲存（`cal_admin_viewers_get`／`cal_admin_viewers_save`，`keys` 只收該社社友庫裡的人；`reset:true` 刪掉該列＝恢復預設；`cal_admin_state` 回傳 `reportCustomClubs`）；**執秘也能設定自己的社**（2026-11-17 使用者同意）：報名系統「📈 出席率」右上「⚙️ LINE 上誰可以看全社」（`cdVwToggle`／`cdVwLoad`／`cdVwSave`／`cdVwReset`，動作 `cal_desk_viewers_get`／`cal_desk_viewers_save`，社密碼只能改自己社、後台密碼用 `targetClub`），理由是執秘用社密碼本來就看得到全社出席率，所以沒有降低保護。兩邊共用 `reportViewersAction()`，`updated_by` 記錄是誰設定的（`報名系統（社名）`／`行事曆後台`）。同行的非社友（`guest:`）不列個人。前端：報名系統分頁「📈 出席率」（`cdeskRenderReport`／`cdArRenderTable`／`cdArExport` 三個工作表：出席率總表、例會出席明細、補出席明細（列出日期、類別、說明、來源＝報到系統／執秘登記）；可搜尋、預設不列寶尊眷；點姓名展開明細，可在明細裡登記／刪除補出席（`cdArMakeupAdd`／`cdArMakeupDel`，友社例會必填哪一社））；LINE 行事曆右上「📊 出席」（`calOpenAttend`，P／S 多「👥 看全社出席率」可搜尋、點人看明細、複製文字）。出席率 ≥60% 綠色、以下紅色。限制：例會要執秘按儲存才算；地區活動只算有報到的；身分以「姓名|Nick Name」對應，社友改名後舊紀錄會對不上。
- **Excel 匯入行程（2026-11-17）**：報名系統「本社行程」／「地區行程」的「📥 Excel 匯入」（`calendar-desk.js` 的 `cdImpOpen`／`cdImpTemplate`／`cdImpFile`／`cdImpCheck`／`cdImpGo`／`cdImpRender`）。讀檔在前端（index.html 已載入的 SheetJS，`sheet_to_json(header:1, raw:true)`），`cdImpParse(aoa, types)` 是純函式：前 15 列內找有「日期」「標題」的標題列（欄位別名見 `CD_IMP_COLS`，括號內文字忽略），`cdImpDate`（2026/12/5、2026-12-05、2026.12.5、民國年、年月日、20261205、Excel 日期數字；不存在的日期回 null）、`cdImpTime`（19:00、1900、下午7:00、7點半、Excel 時間）、`cdImpBool`。沒開始時間或全天＝是 → 全天（00:00～23:59，與手動新增一致）；`結束日期` 給跨天活動；類型找不到 → 「其他」並提醒；`開放我要參加` 預設是。流程：選檔 → 對沒錯誤的列呼叫雲端 `cal_desk_import`（`dryRun:true` 只檢查）→ 預覽（紅＝錯誤、黃＝重複、綠＝可匯入）→ 確認後送出可匯入的列。雲端 `cal_desk_import`：認證同 `cal_desk_save`（社密碼只能匯入自己的社、地區要後台密碼），每筆再 `normalizeEvent`，**重複＝同層同社「標題＋開始時間」相同**（同檔內 `DUP_IN_FILE:<列>`、資料庫已有 `DUP_EXISTING`），一次最多 `IMPORT_MAX`＝300 筆（`CAL_IMPORT_TOO_MANY`），一次 insert。不需要改 SQL。
- **總監每日推播（2026-11-17，規格 6.8）**：pg_cron 每天 UTC 12:00（台灣晚上 8 點）POST `line-checkin` 的 `cal_cron_digest`（排程 SQL 在 `supabase/sql/calendar_governor_cron.sql`，內含 3523 的 Supabase 網址與 LIFF ID；3521 版是 `calendar_governor_cron_3521.sql`；其他地區要改這兩個值），帶 `secret`＝`calendar_settings.cron_secret`（`calendar.sql` 第一次執行時用亂數產生、存在資料庫、anon 讀不到；排程從資料表讀，所以**密碼不會出現在 git 或前端**）。邏輯在 `calendar.ts` 的 `governorDigest(admin, {day, liffId, send, test, now})`：收件人＝`calendar_roles` 的 `governor`（總監）＋ `governor_cc`（總監秘書，收副本，**新角色**，`calendar.sql` 會換掉舊的 role 檢查條件），都要在 `line_bindings` 綁定過；內容＝**總監「私人」頁的行程**（2026-11-19 使用者更正：不是所有地區／社內行程）＝總監的私人行程＋總監已參加的地區／社內活動（`joinedMap`：按了「我要參加」或已被執秘正式報名，`DigestOpts.reg` 由 `lib.ts` 提供 roster），已取消不列，全天在前、其餘依開始時間；沒有行程不推；`buildDigestMessage()` 產生 Flex 卡片（每筆：層級＋時間、標題、社名、📍地點、👔服裝、「查看詳情」＝`https://liff.line.me/<LIFF>?p=calendar&ev=<id>&d=<日期>`，超過 10 筆寫「還有 N 個」；底部「開啟行事曆」）。同一天×總監×收件人只推一次（`calendar_digest_log`）。發送用 `deps.push.sendMessages`（`index.ts`，LINE push API），只需要官方帳號 token（`LINE_MESSAGING_ACCESS_TOKEN`），**不需要推播密碼**（收件人只有後台指定的人）；沒有 token 回 `PUSH_DISABLED`。後台 `admin-calendar.html` 的「④ 總監每日推播」：選日期「預覽」（`cal_admin_digest_preview`，不發送，列出行程與收件人狀態 PREVIEW／NOT_BOUND／NO_EVENTS）與「📤 現在測試發送」（`cal_admin_digest_test`，卡片標【測試】，不檢查也不寫紀錄）；① 多了「設為總監秘書」。LINE 端 `calendar.js` 的 `calOpenDeep(ev, d)`：從卡片打開時直接進該行程詳細頁（不在目前範圍就另外讀那一天）。測試：`deno run --no-check --node-modules-dir=none -A supabase/tests/governor_digest.ts`（25 項）。
- **各社活動提醒推播（2026-11-20）**：`admin-calendar.html` 的「④-2 各社活動提醒推播（允許推播的社）」（`cp*` 函式）逐社開放，**預設全部關閉**（表 `calendar_club_push` 沒有那一列＝關閉；`hour`＝活動前一天幾點推，8～21 整點，預設 20）。排程 `supabase/sql/calendar_club_remind.sql`（3521 版 `_3521`；內含兩張表與 pg_cron `calendar-club-remind`，台灣時間 8:00～21:00 每個整點＝UTC `0 0-13 * * *`）POST `cal_cron_club_remind`（同樣用 `cron_secret` 把關），`calendar.ts` 的 `clubReminder()` 只處理「已開放且 hour＝現在整點」的社。對象＝該社「明天**開始**的地區＋本社社內活動（未取消，私人不算）」中，在 `calendar_rsvp`（含執秘代登記；`guest:` 同行者不算）或正式報名名單（`reg.roster`）裡、且綁定 LINE 的社友；一人一則卡片（`buildDigestMessage` 第 7 個參數換標題）。**不重複**：表 `calendar_push_sent`（發送當天台灣日期×`event_ref`×社×人；`pushRef(e)`＝`registration_key`，沒有就 `cal:<行程id>`）；活動主委的 `push_send` 發送後也寫這張表（`source='chair'`，寫入失敗不影響推播），所以主委當天推過的人，提醒就略過那個活動（只剩其他活動；全略過＝`ALREADY`）。**單向**：主委在提醒之後才推播不會被擋（主委訊息是自訂內容，例如改地點）。總監／總監秘書（已有每日推播）標 `GOV_DIGEST` 不提醒。後台動作 `cal_admin_clubpush_get`／`_save`（`enabled:false`＝刪列）／`_preview`（不發送）／`_send`（正式發送並記錄，限已開放的社 `CAL_CLUB_PUSH_OFF`）。只需官方帳號 token，不需推播密碼。`calendar_push_sent` 只用於當天去重，`member_rename_move` 沒有搬它。測試：`deno run --no-check --node-modules-dir=none -A supabase/tests/club_reminder.ts`（26 項）、`node check_calendar_viewers.js`。
- **總監秘書代管總監的行事曆（2026-11-19）**：後台設為 `governor_cc`（總監秘書）的人，LINE 行事曆上方多「👔 管理總監 … 的行事曆」（`calendar.js` 的 `calGov`／`calSetGov`／`calRenderGovBar`，讀寫時用 `calGovArg()` 附上 `forGov:{club,key}`）。雲端 `loadRoles` 對秘書多回 `roles.secretary`、`roles.govs`（所有 `governor`，不含自己）；`govTarget(body, roles)` 確認真的是他的秘書（不是就 `CAL_FORBIDDEN`）。`cal_list` 帶 `forGov`＝地區＋總監所屬社＋**總監全部的私人行程**（使用者決定秘書可看全部），只有總監私人行程 `canEdit`，不算 `joined`；`cal_save` 帶 `forGov` 新增＝一律存成總監名下的私人行程（`created_by`＝`總監秘書 姓名（社）代為登記`）；修改／取消／刪除不需帶 `forGov`，由 `canWrite()` 的 `isGovOf()` 放行。代管時詳細頁不顯示「我要參加」。總監自己看得到、每日推播也包含。目前只有 LINE 手機版（電腦版輸入尚未做）。不需要改 SQL。**與總監同步（同日加）**：秘書在「自己的」行事曆新增私人行程時，表單有「🤝 同時加入總監的行事曆」（`#cfShare`，預設勾選；送 `shareGov:{club,key}`）→ 雲端只存**一筆**在總監名下，`created_by`＝`syncMark(me)`（`總監秘書 姓名（社）同行`）；秘書自己的 `cal_list` 會另外查出這些列並標 `withGov:true`（卡片顯示「🤝 與總監同步」），所以任一方修改／取消／刪除兩邊一起變。限制：以 `created_by` 字串認，秘書改名或換社後舊的同步行程不再出現在秘書自己的行事曆（仍在總監名下）；秘書的 .ics 訂閱不含這些行程。**秘書按「我要參加」時同步給總監（同日加）**：秘書在地區／社內行程詳細頁有「🤝 同時加入總監的行事曆」（`#calGovSync`，預設勾選，`calGovSyncSel` 保存正在勾的狀態；送 `cal_rsvp_set` 的 `withGov`：true＝幫總監登記、false＝收回、沒帶＝不動）。雲端 `govSyncSet()`：幫總監寫一筆 `calendar_rsvp`（`proxy_by`＝`總監秘書 姓名（社）`，總監自己登記過就不動；秘書取消參加時只收回自己代登記的）。**總監秘書與總監必須同社**（使用者 2026-11-19 規定，這樣秘書看得到的社內行程總監也看得到，不必建複本）：`cal_admin_grant` 指定 `governor`／`governor_cc` 時檢查，不同社回 `CAL_GOV_CLUB_MISMATCH`；`loadRoles` 的 `govs` 也只列同社的總監。**代管畫面也要看得到總監參加的活動**（2026-11-19 修正：原本 `forGov` 的 `cal_list` 一律回 `joined:null`，秘書在「總監私人」頁看不到同步進來的活動）：現在以總監身分算 `joinedMap`；詳細頁 `#calGovReg` 顯示總監參加狀況，並可直接「幫總監登記參加／取消總監的參加」（`calGovRsvp` → 動作 `cal_gov_rsvp`，需帶 `forGov`；正式報名的不能取消 `CAL_RSVP_LOCKED`）。列表在切回 LINE 時自動重讀（`calReloadQuiet`，5 秒內不重複）。`cal_rsvp_status`／`cal_rsvp_set` 回傳 `gov:{name,joined,byMe}`（非秘書為 null）。總監的每日推播因此會包含這些活動。
- **💰 報名／繳費狀況（2026-11-20）**：LINE 行事曆右上「💰 報名」（`calendar.js` 的 `calOpenStats`／`calStatsRender`；有 `registration_key` 的行程詳細頁另有摘要 `#calStatOne`）。**算法只有一份**：`checkin-core.js` 的 `eventStats(state, payments, key)`／`divisionPayRows()`／`listStatEvents()`（主委後台 `computeApportionStats()` 也改呼叫 `divisionPayRows`，所以 index.html 的 script 標籤帶 `?v=` 避免舊快取；改了要 `cp` 到小程式資料夾並重新部署）。三種模式：`apportion`（分攤金／配合款，每社都要繳、不算人數）、`fixed`（研討會／年會，每社固定金額＝`configuredClubFee`，與 `getApportionmentFee` 相同含 3000 預設，`feeSet:false` 時畫面提醒）、`order`（運動賽事、社慶、PELS…＝報名表 `grandTotal`，有報名的社才要繳）；已繳＝`PAID_EMAIL|PAID_MANUAL|EXEMPT`，排除地區辦公室；人數＝`buildRoster`（PELS 攜眷多一位）。使用者決定**不顯示葷素、不推播**。**誰看得到**：總監、總監秘書＝全部；其他人由行事曆後台「⑤」**逐活動指定個人**（可多選、可跨社，`event_key='*'`＝全部活動；地辦人員也用這個，`district_editor` 不會自動看得到）——使用者決定「主委在 LINE 以人為準、由管理者指定」，報名系統的 `eventChairs`（社）不動。表 `calendar_stat_viewers`（anon 讀不到；**SQL 需重跑**，沒建表時 `statAccess` 當作沒人被指定）。動作：`cal_stats`（帶 `key`＝單一活動）、`cal_admin_statviewers_get`／`_save`（整批取代、只收社友庫裡的人）；`cal_init` 回傳 `canStats`／`statAll`／`statKeys`。資料由 `lib.ts` 的 `statDeps()` 讀 `app_storage` 主資料與 `rotary_3523_payment_records_v1`（同一請求只讀一次）。更新時機：打開、按重新整理、切回 LINE（沒有訂閱 Realtime）。**預設只列「今天起 2 個月內」的活動＋分攤金／配合款**（使用者 2026-11-20 要求不要列這麼多；`calStatsInWindow`，底部「顯示全部活動」可切換 `calStatsShowAll`）：每筆統計帶 `date`＝主委填的 `chairConfig.eventDates[key].date`，沒填就用行事曆上 `registration_key` 相同的行程（今天以後最近一場，否則最後一場；已取消與私人不算），都沒有＝空字串＝預設不列。活動改名後舊的指定不再生效（後台會提示筆數）。測試：`deno run --no-check --node-modules-dir=none -A supabase/tests/event_stats.ts`（22 項）。
- **LINE 聊天室關鍵字回覆（Webhook，2026-11-17）**：官方帳號的 Webhook URL＝`line-checkin` 的網址。`index.ts` 看到 `x-line-signature` 標頭就走 Webhook：用 secret `LINE_MESSAGING_CHANNEL_SECRET` 驗證簽章（`lib.ts` 的 `verifyLineSignature`，失敗回 401），再 `handleWebhook(events, deps)`，**一律回 200**（LINE 才不會重送）。只處理「一對一聊天、文字訊息、整句剛好是關鍵字」（`calendar.ts` 的 `parseAgendaKeyword`：行事曆／行程…＝今天＋明天、今天、明天、本週＝最近 7 天；全形與標點容忍，「明天見」不會觸發），其他訊息、群組、加好友、貼圖都不處理（交給官方帳號原本的自動回應）。用 `source.userId` 查 `line_bindings`（Messaging API 與 LINE Login 在同一個 Provider，所以代碼相同）→ `agendaReply()` 回 Flex 卡片（與總監推播共用 `eventBox`／`eventsOfPerson`：地區＋所屬社＋本人私人，依日期分組，最多 12 筆），沒綁定回綁定連結。用 reply API（`deps.reply`，**不算推播額度**），需要 `LINE_MESSAGING_ACCESS_TOKEN` 與 secret `LINE_LIFF_ID`（連結用）。Channel secret 由使用者點兩下 `設定LINE聊天回覆.command` 輸入（不經過對話）。測試：`deno run --no-check --node-modules-dir=none -A supabase/tests/line_webhook.ts`（14 項）。
- 測試：Excel 匯入規則＝`node check_calendar_import.js`（純 node，17 項）；權限與 .ics＝`deno run --no-check --node-modules-dir=none -A supabase/tests/calendar_permissions.ts`（假資料庫，202 項，含 desk、報名名單、活動日期同步、我參加的活動、例會與寶尊眷、出席與統計、執秘代登記、誰可看全社出席率）；LINE 畫面＝`node check_calendar_ui.js`（80 項，不需 8000 埠）；報名系統裡的管理畫面＝先啟動 8000 埠 `python3 -m http.server 8000` 再 `node check_calendar_desk.js`（79 項，用真的 index.html，擋掉所有寫入 Supabase 的請求）；後台「誰可看全社出席率」＝`node check_calendar_viewers.js`（需 8000 埠，假的雲端回應）。改了雲端小程式要重新部署：Finder 點兩下 `部署行事曆.command`。

### 歷屆備份與清空單一活動（2026-11-20）

主委後台面板 `data-panel="eventArchive"`（`renderArchivePanel()` 由 `updateRolePermissionsUI()` 呼叫，只用 `archiveState` 重畫；換活動或展開才 `refreshArchivePanel()` 連網，`archiveFetchSeq` 丟棄過期結果；面板不放 `<input>`）。主委與最高管理員都看得到該活動的歷屆備份（👁 查看＝`viewEventArchive` 動態建立 `#archiveViewerOverlay`、📥 `exportEventArchiveExcel` 六個工作表）；**「📦 備份並清空本活動」只有 `super_admin`**（`archiveAndResetCurrentEvent()`）。流程順序不可改：`pullRemoteState(true)` → `collectEventArchiveData()`（報名表、繳費紀錄、費用、活動日期、主委社、分區快照、該活動的銀行入帳、報到紀錄；摘要用 `CheckinCore.eventStats`）→ insert `event_archives` → **讀回來核對筆數** → 下載一份 JSON 到本機 → 才 `delete registrationOrders[子活動]`、`delete chairPaymentRecords[key]` 並存檔 → 銀行入帳的 `matched_key` 改成 `key::封存#<備份id>`（不再出現在新一屆的入帳明細，也不會被重新配對）→ 有報到紀錄時 prompt 報到密碼呼叫 `checkin_reset`（取消就保留）。**備份失敗或核對不符就不清空**；費用設定、活動日期、DM、主委指派保留；行事曆的「我要參加」不動。表 `event_archives`（`supabase/sql/event_archives.sql`）：anon 只能 select＋insert，沒有 update／delete，所以備份改不掉也刪不掉（內容與 app_storage 原本公開的報名資料相同，不含旅平險個資）；`summary.stats` 留作歷年統計。沒建表時面板顯示「尚未啟用」且不能清空。面板文字用 `.archive-event-name` 與 `evTag` 帶出目前子活動名稱。**總覽**：面板裡「📚 全部活動的備份總覽」（只有 `super_admin`，`openArchiveOverview()` → `#archiveOverviewOverlay`，z 比單份檢視視窗低一層所以可疊著看）：只讀摘要欄位、依主選單順序排（已改名或刪除的活動標示並排最後）、可依備份名稱（屆別）篩選、`exportArchiveOverviewExcel()` 一列一份備份。活動改名後舊備份（以 key 查）不會出現在新名稱下。測試：`node check_event_archive.js`（需 8000 埠；用線上資料唯讀、所有寫入攔下）。

### 扶輪年度自動計算＋活動結束後的備份提醒（2026-11-20）

- **年度自動**：`scripts/build-config.js` 產生的 `district-config.js` 尾端有一段執行期程式，依台灣時間（7/1 換年度）覆寫 `DISTRICT.rotaryYear`／`rotaryYearLong`，並提供 `DISTRICT.rotaryYearOf(ms)`；設定檔寫 `"rotaryYearAuto": false` 才固定用設定檔的值（`check_district.js` 的測試設定就是這樣）。設定檔的 `rotaryYear` 仍是必填，只當後備值。備份的預設名稱＝**活動日期當時**的年度（有 `eventDates` 才算得出來，否則用今天的年度）。
- **備份提醒**（`calendar.ts` 的 `backupReminder`／`backupDueEvents`）：每晚 8 點的 `cal_cron_digest` 排程在總監推播後順便執行（try/catch，失敗不影響總監推播；回傳多一個 `backup:{due,sent}`）。條件：活動日期（`fillStatDates`：主委填的，否則行事曆行程）在 7～21 天前、還有報名或已繳紀錄、活動日期之後 `event_archives` 沒有新備份、`calendar_settings` 沒有 `backup_reminded::<key>::<日期>`。收件人＝`calendar_settings` 的 `backup_notify`（JSON 陣列，可多人＝備援人員，要綁定 LINE），由 `admin-calendar.html`「⑥ 系統管理者」設定（`cal_admin_backupnotify_get`／`_save`／`_test`；只收社友庫裡的人、最多 20 位）。有發成功才記成已提醒（沒人綁定時之後還會補發）。**只提醒，不會自動備份或清空**；分攤金／配合款沒有日期不提醒。不需要改 SQL。系統本身沒有「管理者是誰」的概念（最高管理員只是一組共用密碼），這份名單是唯一記錄「誰是系統管理者」的地方。

### UI 慣例

- 主委後台（`viewChair`）與最高權限頁（`viewSuperAdmin`）的每張卡片都是「可收合面板」：卡片外層有 `data-panel="id"`，內容包在 `#panelBody_<id>`（預設 `hidden`），標題列由 `togglePanel(id)` 切換並記在 localStorage（`rotary_3523_panel_open_<id>`）；`initCollapsiblePanels()` 在 DOMContentLoaded 還原狀態。新增卡片時比照加上標題列與一句「點開可以：…」的白話說明。KPI 四格固定在 `viewChair` 最上方，不收合。
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
