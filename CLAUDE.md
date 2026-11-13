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
