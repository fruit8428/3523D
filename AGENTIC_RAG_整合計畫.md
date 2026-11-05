# Agentic RAG 整合計畫 — 國際扶輪 3523 地區報名系統

> 本文件寫給 Claude Code 讀取並執行。
> 使用方式：把本檔放在報名系統專案根目錄，在 Claude Code 輸入
> 「請讀取 AGENTIC_RAG_整合計畫.md，從『階段 0』開始執行，每個階段完成後停下來等我確認」。
> 之後每次只要說「繼續下一階段」即可。

---

## 一、專案目標

1. 把已建置好的 **Agentic RAG**（獨立專案，位於 `../agentic-rag`，GitHub 私人儲存庫）整合進 **國際扶輪 3523 地區報名系統**（本專案）。
2. 整合完成後，把系統「去地區化」：所有 3523 專屬內容抽成設定值，讓**同一份程式碼**可以部署給另外 11 個扶輪地區使用。
3. 部署模式：**一個 GitHub 儲存庫 → 多個 Vercel 專案 → 每個地區一個獨立 Supabase + 一個獨立 LINE OA**。

```
GitHub（一份程式碼）
   ├─ Vercel 專案 rotary-3523 → Supabase 3523 → LINE OA 3523
   ├─ Vercel 專案 rotary-3481 → Supabase 3481 → LINE OA 3481
   └─ ...（共 12 個地區）
```

### 全台扶輪地區清單與命名規則

| 地區代號 | Vercel 專案名稱 | Vercel 預設網址 | Supabase 專案名稱 | 本機環境檔 |
|---|---|---|---|---|
| 3461 | `rotary-3461` | `rotary-3461.vercel.app` | `rotary-3461` | `.env.3461.local` |
| 3462 | `rotary-3462` | `rotary-3462.vercel.app` | `rotary-3462` | `.env.3462.local` |
| 3470 | `rotary-3470` | `rotary-3470.vercel.app` | `rotary-3470` | `.env.3470.local` |
| 3481 | `rotary-3481` | `rotary-3481.vercel.app` | `rotary-3481` | `.env.3481.local` |
| 3482 | `rotary-3482` | `rotary-3482.vercel.app` | `rotary-3482` | `.env.3482.local` |
| 3490 | `rotary-3490` | `rotary-3490.vercel.app` | `rotary-3490` | `.env.3490.local` |
| 3501 | `rotary-3501` | `rotary-3501.vercel.app` | `rotary-3501` | `.env.3501.local` |
| 3502 | `rotary-3502` | `rotary-3502.vercel.app` | `rotary-3502` | `.env.3502.local` |
| 3510 | `rotary-3510` | `rotary-3510.vercel.app` | `rotary-3510` | `.env.3510.local` |
| 3521 | `rotary-3521` | `rotary-3521.vercel.app` | `rotary-3521` | `.env.3521.local` |
| 3522 | `rotary-3522` | `rotary-3522.vercel.app` | `rotary-3522` | `.env.3522.local` |
| 3523 | 沿用現有專案 | 沿用現有網址 | 沿用現有專案 | `.env.local`（測試）/ `.env.local.production.bak`（正式） |

- 3523 是第一個地區，已在線上運作，**不要改名**現有的 Vercel 與 Supabase 專案，以免網址與 LINE Webhook 失效。
- 其他 11 個地區依此命名；`.env.<代號>.local` 全部不進 git（`.gitignore` 的 `.env*.local` 已涵蓋）。
- 若 Vercel 專案名稱已被他人佔用（`vercel.app` 網域是全球共用），改用 `rotary-<代號>-tw`，並在本表更新。
- 預設網址只是暫用，正式交付前依階段 10 設定自訂網域。

### 各地區的「專屬感」原則

各地區的執秘與社員只會收到自己地區的連結與條碼，看到的是自己地區的名稱、Logo 與網址。**報名系統的程式碼與畫面中不得出現任何「多地區」「共用」「地區清單」的內容**；跨地區的管理功能一律放在獨立的「總管理後台」專案（見階段 10），只有 Fruit 能進入。

---

## 二、Claude Code 必須遵守的原則

1. **不破壞現有功能**：報名、簽到、會員查詢等現有功能的檔案，除非本計畫明確要求，否則不得修改。
2. **先規劃再動手**：每個階段先列出要做的事，等 Fruit 回覆「確認」才執行。
3. **RAG 相關程式集中放置**：全部放在 `lib/agentic-rag/`、`app/api/rag/`、`scripts/rag/`，不可散落在其他資料夾。
4. **資料表命名**：RAG 新增的資料表一律以 `rag_` 開頭，不得修改任何現有資料表的欄位。
5. **金鑰安全**：`.env`、`.env.local` 永遠不進 git；`SUPABASE_SERVICE_ROLE_KEY` 只能出現在伺服器端程式，不得出現在任何會送到瀏覽器的程式碼。
6. **資料庫操作**：本計畫前半段只連「測試用 Supabase」，正式資料庫要到階段 9 才碰，而且每一步都要先告訴 Fruit 要執行什麼 SQL。
7. **AI 的權限**：Agentic RAG 的工具只能讀取 `rag_` 資料表，以及「查詢使用者本人」的報名狀態；不得讀取其他會員個資，不得修改任何報名資料。
8. **解釋給初學者聽**：Fruit 是程式初學者，每次回報請用白話文，說明「做了什麼、為什麼、接下來要 Fruit 做什麼」。
9. **每個階段結束後**，在本文件最後的「進度記錄」加一行，寫明日期與完成項目。

---

## 三、實際環境（階段 0 已確認，2026-11-05）

原計畫假設兩個專案都是 Next.js，實際不是。經 Fruit 確認採 **方案 A：兩個系統各自部署，用「連結 + 共用資料」整合，不搬程式碼**。以下是真實狀況，後面所有階段都以此為準。

| 項目 | 報名系統（本專案） | Agentic RAG（母版） |
|---|---|---|
| 路徑 | `/Users/fruit/Documents/insta360/01扶輪/3523報名表` | `/Users/fruit/Documents/AI Agent/RAG` |
| GitHub | `fruit8428/3523D`（公開） | `fruit8428/agentic-rag`（公開） |
| 技術 | 單一檔案 `index.html`，純靜態，無建置 | 前端 React 19 + Vite 6 + TS；後端 Python FastAPI |
| 部署 | GitHub Pages `fruit8428.github.io/3523D` + Vercel `3523d.vercel.app` | Vercel `agentic-rag-dusky.vercel.app`（前後端同一專案） |
| Supabase | 專案 Rotary-3523，表 `app_storage`（整包 JSON）、`bank_*` | 專案 3523RAG，表 `threads`、`messages`、`documents`、`document_chunks`、`clubs`、`profiles` |
| 模型 | 無 | Gemini `gemini-3.5-flash`；embedding `gemini-embedding-001`，768 維 pgvector |
| 登入 | 社名 + 社密碼（存 `app_storage`） | 社名 + 社密碼（每社一個 Supabase Auth 帳號） |
| LINE | 只有「分享到 LINE」連結，無 LINE OA / LIFF | 無 |

**方案 A 的整合方式**
1. 報名系統執秘頁加一顆「🤖 AI 小幫手」按鈕，開新分頁連到 RAG 網址並帶上社名，RAG 登入頁自動選好社名。兩邊密碼暫時各自獨立。
2. RAG 後端新增工具 `get_my_club_registration`，用**唯讀**方式讀報名系統 Supabase 的 `app_storage`，只回傳登入社自己的報名與繳費狀態。
3. 去地區化在兩個專案各自做；每個地區＝一個報名系統 Vercel 專案 + 一個 RAG Vercel 專案 + 兩個 Supabase 專案。

**原則調整**（取代第二節的第 3、4、6、7 條）
- RAG 相關程式集中在母版的 `backend/app/services/signup_bridge.py`、`backend/app/routers/chat.py`（只加工具）、`frontend/src/components/AuthPage.tsx`（只加網址參數）；報名系統端只改 `index.html` 加按鈕與設定。
- 本次整合**不新增任何資料表**，兩邊資料庫結構都不動，因此不需要另建測試用 Supabase。RAG 讀報名系統資料只用 anon key（該表本來就對 anon 開放），不碰 service role。
- AI 工具只能讀「登入社本身」的報名與繳費狀態；地區管理員可指定社名查詢；不得寫入任何報名資料。

---

## 階段 1：工作分支與整合規劃書

**目標**：兩個專案各開 `feature/agentic-rag` 分支，產出具體到檔案層級的規劃書。

### Claude Code 執行
1. 兩個專案各 `git checkout -b feature/agentic-rag`。
2. 在本專案產出 `docs/rag-integration-plan.md`：要改的檔案對照表、工具的輸入輸出格式、環境變數清單、資料契約（RAG 怎麼解讀 `app_storage` 的 JSON）、預估 commit 數。
3. 不修改任何程式碼。

### 完成條件
Fruit 閱讀 `docs/rag-integration-plan.md` 後回覆「確認」或提出修改。

---

## 階段 2：RAG 後端「本社報名查詢」工具

**目標**：在 RAG 問「我們社報名了什麼」能查到報名系統的真實資料。

### Claude Code 執行（在母版專案）
1. 新增 `backend/app/services/signup_bridge.py`：
   - 用 `httpx` 呼叫報名系統 Supabase REST（`SIGNUP_SUPABASE_URL` + `SIGNUP_SUPABASE_ANON_KEY`），讀 `app_storage` 的主 key 與繳費紀錄 key。
   - 60 秒記憶體快取，避免每句話都抓整包 JSON。
   - `get_club_registration(club_name)`：整理成「每個子活動：報名人數、名單、總金額、送出時間、繳費狀態」。
2. `backend/app/config.py` 新增 `SIGNUP_SUPABASE_URL`、`SIGNUP_SUPABASE_ANON_KEY`、`SIGNUP_STORAGE_KEY`、`SIGNUP_PAYMENT_KEY`、`SIGNUP_SITE_URL`；未設定時工具回「本地區尚未連接報名系統」而不是報錯。
3. `backend/app/routers/chat.py`：註冊工具 `get_my_club_registration`（參數只有選填 `club_name`，一般使用者傳了也會被忽略、強制用登入社；管理員才生效）；system prompt 加規則：報名、繳費、個人資料一律用工具查，不得用知識庫猜；問他社資料要拒絕。
4. `.env.example` 加上新變數與中文說明。
5. 本機測試：用 `backend/venv` 啟動後端，以測試社登入問三題（有報名、沒報名、問別社）。

### Fruit 手動
把五個新變數填進母版 `.env`，並跑 `scripts/sync_vercel_env.sh` 同步到 Vercel。

### 完成條件
三題答對：有報名列出明細、沒報名明確說沒有、問別社被拒絕。

---

## 階段 3：報名系統「AI 小幫手」按鈕 + RAG 登入頁帶入社名

### Claude Code 執行
1. 母版 `frontend/src/components/AuthPage.tsx`：讀網址參數 `?club=社名`，若在社名清單內就預選並勾「記住社名」。
2. 本專案 `index.html`：
   - 設定區加 `RAG_ASSISTANT_URL`（空字串＝不顯示按鈕）。
   - 執秘快捷列 `#secQuickActionsBar` 加「🤖 AI 小幫手」按鈕，`openRagAssistant()` 開新分頁 `RAG_ASSISTANT_URL?club=<encodeURIComponent(selectedClubName)>`。
   - 手機版也要看得到。
3. 跑 `node extract_js.js && node -c test.js`，再用 puppeteer 腳本確認按鈕存在且連結正確。
4. 更新 `README.md` 說明這顆按鈕。

### 完成條件
從報名系統按按鈕，RAG 登入頁已選好該社，輸入 RAG 社密碼即可問答。

---

## 階段 4：安全加固

### Claude Code 執行（母版）
1. `/api/chat/stream` 加每社每分鐘 10 次的速率限制（記憶體計數即可，Vercel 無狀態時以「每個執行個體」計）。
2. 全專案搜尋 `SERVICE_ROLE`、`sb_secret_`，列出所有出現位置，確認只在後端與 `.env`。
3. 確認 `signup_bridge.py` 只有 GET，沒有任何寫入路徑。
4. 寫 `docs/rag-security-checklist.md`（放本專案），列上線前檢查項目。

### 完成條件
未登入呼叫 chat API 被拒；超過 10 次回 429；清單中沒有外洩位置。

---

## 階段 5：報名系統去地區化

**目標**：`index.html` 裡不再寫死 3523，改由設定檔與環境變數提供。

### Claude Code 執行
1. 全檔搜尋 3523 專屬內容（目前 45 處：標題、頁尾、匯出檔名、LINE 文字、ics、`DEFAULT_DIVISIONS_DATA` 80 社名冊、Supabase URL/key、示範 email），列清單給 Fruit 確認。
2. 建立 `config/districts/3523.json`（地區代號、名稱、年度、分區與社名冊，**不含金鑰**）。
3. 建立 `scripts/build-config.js`：讀環境變數 `DISTRICT_CODE`（預設 3523）、`SUPABASE_URL`、`SUPABASE_ANON_KEY`、`RAG_ASSISTANT_URL`，合併 `config/districts/<code>.json`，產生 `district-config.js`（進 `.gitignore`）。
4. `index.html` 在主程式前載入 `district-config.js`，所有寫死處改讀 `window.DISTRICT`；若檔案不存在則退回 3523 預設值（讓 `file://` 直接開也能跑）。
5. Vercel 加 `vercel.json` 的 `buildCommand`；GitHub Pages 的 `deploy.yml` 加一步執行同一支腳本，金鑰放 repo Secrets。
6. `.gitignore` 補 `.env*`、`!.env.example`、`district-config.js`。
7. 跑語法檢查與全部 `check_*.js`，確認行為不變。

### 完成條件
`grep 3523 index.html` 只剩退回用預設值那一處；換 `DISTRICT_CODE` 重新建置，畫面標題與社名冊跟著變。

---

## 階段 6：RAG 去地區化

### Claude Code 執行（母版）
1. 盤點 3523 寫死處（system prompt、`clubs.csv` 種子、登入頁文字、合成 Email 網域 `clubs.3523.local`、`ADMIN_EMAIL` 預設值）。
2. `config.py` 新增 `DISTRICT_CODE`、`DISTRICT_NAME`；`/api/auth/config` 回傳給前端顯示；合成 Email 改 `club-{id}@clubs.{DISTRICT_CODE}.local`（**3523 既有帳號不動**，只影響新建）。
3. `supabase/seed/clubs.csv` 改為 `supabase/seed/clubs.<代號>.csv`，加 `scripts/seed_clubs.py --district 3481`。
4. `.env.example` 分成「每個地區都不同」與「所有地區共用」兩區。

### 完成條件
母版專案搜尋 3523 只剩 `.env`、種子檔名與文件。

---

## 階段 7：Preview 測試

### Claude Code 執行
1. 產出本專案 `docs/test-checklist.md`：報名系統原有功能、AI 小幫手按鈕、RAG 三類問答、速率限制、去地區化換變數。
2. 兩個專案 commit 並 `git push -u origin feature/agentic-rag`。

### Fruit 手動
1. 兩個 Vercel 專案 → Settings → Environment Variables，依各自 `.env.example` 新增變數，勾 Preview。
2. 開兩個 Preview 網址，照 checklist 測，失敗項目貼給 Claude Code。

### 完成條件
checklist 全部通過。

---

## 階段 8：3523 正式上線

**本階段每一步執行前都要先告訴 Fruit 並取得確認。** 本次沒有資料庫 migration，不需要備份或改正式資料庫。

### Fruit 手動
1. 兩個 Vercel 專案的 Production 環境變數填上。
2. GitHub → 兩個倉庫 → 各開 PR 合併到 `main`（報名系統另需在 repo Secrets 放 GitHub Pages 建置用的變數）。
3. 等部署完成，到正式網址照 checklist 快速測一次，回覆「上線完成」。

---

## 階段 9：新地區上線手冊與總管理後台

### Claude Code 執行
1. `docs/新地區上線手冊.md`：Supabase（兩個專案、各自要跑的 SQL：報名系統 `supabase/sql/*.sql`、RAG `supabase/migrations/*.sql`）→ Vercel（兩個專案、環境變數）→ 社名冊 json 與 seed → 匯入知識 → 自訂網域 → 測試。
2. `scripts/setup/new-district-checklist.md`：可打勾清單，含 12 地區命名表（每地區兩個 Vercel 專案：`rotary-<代號>`、`rotary-<代號>-ai`）。
3. 總管理後台：獨立專案 `../rotary-admin-console`（清單、狀態、條碼產生器，不連任何 Supabase）。
4. 選做：`scripts/rag/migrate-all.ts`。

### 完成條件
Fruit 用手冊建立第二個地區（可用測試資料）並成功運作。

---

## 後續維護規則（寫給未來的 Claude Code）

- 兩個系統各自獨立部署：RAG 功能改在母版 `/Users/fruit/Documents/AI Agent/RAG`，報名系統只維護「AI 小幫手」按鈕與設定值。
- 任何新增資料表的修改，報名系統寫成 `supabase/sql/`、RAG 寫成 `supabase/migrations/` 檔案，並提醒 Fruit 要對所有地區的 Supabase 執行。
- 任何新功能上線前，先在 Preview 測試；重大更新先只讓 3523 上線觀察，再讓其他地區跟上。
- 永遠不要在程式碼裡寫死任何地區專屬內容：報名系統進 `config/districts/<代號>.json` 與環境變數，RAG 進 `config.py` 的環境變數。
- 要新增或更換 LLM 廠商時，只在母版 `backend/app/llm.py` 改，不得在其他地方直接呼叫廠商 SDK；更換後必須重測 RAG 測項。

---

## 進度記錄

| 日期 | 階段 | 完成項目 | 備註 |
|------|------|----------|------|
| 2026-11-05 | 階段 0 | 環境確認與安全檢查完成，發現與「環境假設」有重大差異（本專案是單檔靜態 HTML、母版是 React+Vite 前端＋Python FastAPI 後端、母版位於 `/Users/fruit/Documents/AI Agent/RAG`），已提出調整方案，等待 Fruit 確認 | 兩邊 git 皆乾淨、無 .env 進 git；兩個 GitHub 倉庫皆為公開 |
| 2026-11-05 | 階段 1 | Fruit 確認方案 A（AI 小幫手先放網頁按鈕、倉庫維持公開）；計畫文件依方案 A 重寫；兩個專案各開 `feature/agentic-rag` 分支；產出 `docs/rag-integration-plan.md` | 等待 Fruit 閱讀規劃書後回覆「確認」 |
| 2026-11-05 | 階段 2 | RAG 後端新增 `get_my_club_registration` 工具（`signup_bridge.py`）、system prompt 規則、`SIGNUP_*` 環境變數、前端來源卡片；純函式測試 11 項與端到端測試 11 項全部通過；兩邊 81 社名稱完全一致 | 母版分支 `feature/agentic-rag` 兩個 commit；等 Fruit 把變數同步到 Vercel |
| 2026-11-05 | 階段 3 | 報名系統執秘快捷列新增「🤖 AI 小幫手」按鈕（`RAG_ASSISTANT_URL` 設定、`openRagAssistant()` 帶社名開新分頁，puppeteer 驗證通過）；RAG 登入頁支援 `?club=` 自動選社（tsc 與 vite build 通過）；README 已更新 | 兩邊皆在 `feature/agentic-rag` 分支，未 push |
| 2026-11-05 | 階段 4 | RAG 聊天 API 加每社每分鐘 10 次速率限制（429 + Retry-After），防護測試 5/5 通過；金鑰盤點：service role 只在後端、測試腳本與報名系統雲端小程式，前端皆無；橋接模組只有 GET；產出 `docs/rag-security-checklist.md` | 等 Fruit 確認後進入階段 5（報名系統去地區化） |
| 2026-11-05 | 階段 5 | 報名系統去地區化：47 處 3523 專屬內容改讀 `config/districts/3523.json` → `scripts/build-config.js` → `district-config.js`（3523 版進 git 當預設）；名冊 410 行移出 `index.html`；新增 `vercel.json`、`.vercelignore`、`_template.json`；`index.html` 只剩 5 個刻意保留的儲存 key；puppeteer：原有登入、AI 按鈕、測試地區切換（11 項）全部通過；CLAUDE.md 與 README 同步更新 | 分支 `feature/agentic-rag`，未 push；Vercel 的 `vercel.json` 建置設定要到階段 7 Preview 才會第一次實際執行 |
| 2026-11-05 | 階段 6 | RAG 去地區化：`DISTRICT_CODE`/`DISTRICT_NAME` 環境變數（預設 3523）、合成 Email 網域、設定端點與前端 `useDistrict()`、提示詞服務對象、009 遷移檔拆出種子改 `seed_clubs.py --district`、`.env.example` 分兩區；e2e 回歸 73/73 通過 | 母版分支 `feature/agentic-rag` 共 6 個 commit，未 push |
| 2026-11-05 | 階段 7 | 產出 `docs/test-checklist.md`（38 項）；兩個專案 `feature/agentic-rag` 分支 push 到 GitHub，Vercel 自動建 Preview | 等 Fruit 同步環境變數並照清單實測 |
