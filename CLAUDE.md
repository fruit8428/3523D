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
- **示範資料不會自動生成**：`loadDemoPaymentRecords()`、`DEFAULT_MEMBERS_DB`、`DEFAULT_ORDERS` 只有最高管理員在「正式上線前資料歸零」卡片按「載入示範資料」才會寫入；`selectClub` 與新增社都只建立空名冊。清空功能 `adminClearPaymentData` / `adminClearRegistrationOrders` / `adminClearMemberDatabase` 皆限 `super_admin`，清空後要同時寫回主 key 與獨立 key。
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

### LINE 推播提醒（2026-11-14）

主委對「已報名且已綁定 LINE」的社友發送提醒，**逐一地區由系統管理者（Fruit）開放**，預設關閉。
- **兩道開關**：畫面＝地區設定檔 `linePushEnabled`（且要有 `lineLiffId`）→ `LINE_PUSH_ENABLED`，面板 `data-panel="linePush"`；真正把關在雲端小程式：secret `LINE_MESSAGING_ACCESS_TOKEN`（官方帳號 Messaging API 的 token）與 `LINE_PUSH_PASSWORD` **都有值**才算開放，且每次操作都要帶對的推播密碼（錯誤故意延遲 1 秒）。3521（官方帳號 `@007eapij`）與 3523（`@628ouczd`，2026-11-14 開放）都已開放。**不要改成用社的登入密碼把關**：`clubPasswords` 在 `app_storage` 是公開可讀的，推播會花錢又會打擾社友。
- **動作**（都在 `line-checkin` 的 `lib.ts`，`deps.push` 可替換成假的發送器做測試）：`push_status`、`push_preview`（人數、未綁定名單、本月用量）、`push_send`、`push_history`。對象由伺服器用 `CheckinCore.buildRoster` → `mergeCheckins` 算出（只含報名名單上的人，現場加報不算），再用 `line_bindings` 找出 LINE 使用者代碼；**前端只送篩選條件（社名清單、狀態、參加方式），不送名單也不送使用者代碼**。訊息含 `{姓名}`／`{社名}` 時一人一則（8 個一批），否則用 multicast（一次最多 500 人）。同活動 60 秒內相同訊息會擋下（`PUSH_DUPLICATE`）。另一種對象 `filter.audience === 'all_friends'`＝官方帳號所有好友（LINE broadcast，不看報名與綁定；不可含 `{姓名}`／`{社名}`→`PUSH_NO_PERSONAL`；好友人數取自 LINE insight API 前一天的統計，新帳號查不到時為 null，畫面要能處理）。每次發送寫一筆 `line_push_log`（`supabase/sql/line_push.sql`，anon 讀不到）。
- **面板有輸入框，所以不跟著 `updateRolePermissionsUI()` 重畫內容**：`renderLinePushPanel()` 只切換顯示，`linePushKey` 變了（換活動）才重設對象清單與預設訊息。條件一改就 `linePushInvalidate()`，要重新預覽才能按發送；推播密碼只放記憶體（`linePushPassword`），不進 localStorage。面板的任何操作都不呼叫 `saveToStorage()`。
- 限制：社友要把官方帳號加為好友才收得到，系統無法得知誰沒加；官方帳號的 Messaging API 頻道要與 LINE Login 頻道在同一個 Provider（使用者代碼才相同）。

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
