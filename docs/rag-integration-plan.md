# Agentic RAG 整合規劃書（方案 A）

> 階段 1 產出。這份文件把「要改哪些檔案、資料怎麼流動、要加哪些設定」寫到可以直接動手的程度。
> 讀完若沒有問題，回覆「確認」即進入階段 2。

## 1. 整體架構

```
執秘的瀏覽器
   │  ① 在報名系統按「🤖 AI 小幫手」
   ▼
報名系統（index.html，靜態）────────── Supabase「Rotary-3523」
   │  開新分頁 RAG 網址?club=社名            ▲ app_storage（整包 JSON）
   ▼                                        │ ③ 唯讀（anon key）
RAG 前端（React）──② 登入──► RAG 後端（FastAPI）
                                   │  工具 get_my_club_registration
                                   ▼
                          Supabase「3523RAG」（知識庫、對話紀錄）
```

兩個系統**各自部署、各自資料庫**，只多兩條線：① 按鈕帶社名跳轉、③ RAG 後端唯讀報名資料。

## 2. 要改的檔案對照表

| 專案 | 檔案 | 動作 | 階段 |
|---|---|---|---|
| RAG | `backend/app/services/signup_bridge.py` | **新增**。抓報名系統 `app_storage`、整理成每社報名摘要、60 秒快取 | 2 |
| RAG | `backend/app/config.py` | 加 5 個 `SIGNUP_*` 環境變數（皆選填） | 2 |
| RAG | `backend/app/routers/chat.py` | `RAG_TOOLS` 加一個工具；`run_agentic_rag_turn` 加一個分支；`SYSTEM_PROMPT` 加規則 | 2 |
| RAG | `.env.example` | 加變數說明 | 2 |
| RAG | `frontend/src/components/AuthPage.tsx` | 讀 `?club=` 預選社名 | 3 |
| 報名 | `index.html` | 設定區加 `RAG_ASSISTANT_URL`；快捷列加按鈕；新增 `openRagAssistant()` | 3 |
| 報名 | `README.md` | 說明按鈕 | 3 |
| RAG | `backend/app/routers/chat.py` | 速率限制 | 4 |
| 報名 | `docs/rag-security-checklist.md` | **新增** | 4 |
| 報名 | `config/districts/3523.json`、`scripts/build-config.js`、`vercel.json`、`.github/workflows/deploy.yml`、`.gitignore`、`index.html` | 去地區化 | 5 |
| RAG | `backend/app/config.py`、`routers/auth_router.py`、`services/club_accounts.py`、`supabase/seed/`、`.env.example` | 去地區化 | 6 |

不會動到：報名系統任何資料表、RAG 任何資料表、兩邊既有的登入流程。

## 3. 資料契約：RAG 怎麼讀報名系統的資料

報名系統把整個狀態存成一個 JSON，放在 `app_storage` 表：

| key | 內容 | RAG 會用到的欄位 |
|---|---|---|
| `rotary_3523_spa_data_v3` | 主資料 | `registrationOrders`、`categoriesData`、`chairConfig.subEventFees`、`chairConfig.bankAccount` |
| `rotary_3523_payment_records_v1` | 繳費紀錄 | `{ "大類id::子活動名稱": { "社名": { status, amount, method, date, note, remitNote, remitAmount, remitDate } } }` |

`registrationOrders` 的結構是 `{ "子活動名稱": [ Order, ... ] }`，每筆 Order：

```json
{
  "clubName": "臺北市南區扶輪社",
  "submittedAt": "2026-11-05 10:30",
  "grandTotal": 12000,
  "items": [ { "name": "王小明", "nickname": "Tony", "role": "社長", "type": "參賽", "diet": "葷" } ],
  "prizeSponsors": [ ... ],
  "sponsorTier": "", "sponsorAmount": 0
}
```

RAG 的工具只做三件事：
1. 用 REST `GET /rest/v1/app_storage?key=in.(...)` 抓兩個 key（anon key，該表 RLS 本來就對 anon 開放）。
2. 從 `registrationOrders` 挑出 `clubName === 登入社名` 的 Order，對應到 `categoriesData` 找大類名稱，再去繳費紀錄用 `大類id::子活動名稱` 找該社的繳費狀態。
3. 回傳精簡摘要給模型（每個子活動：人數、名單、金額、送出時間、繳費狀態中文），**不把整包 JSON 丟給模型**。

繳費狀態對照：`PAID_EMAIL`／`PAID_MANUAL`／`EXEMPT` → 已繳；`NOTIFIED` → 已回報匯款、待核對；其他 → 未繳。

### 工具定義

```
get_my_club_registration(club_name?: string)
```
- 一般使用者：`club_name` 一律忽略，強制用登入社（`user.club_name`）。
- 地區管理員（`user.is_admin`）：可指定 `club_name`。
- 未設定 `SIGNUP_SUPABASE_URL`：回「本地區尚未連接報名系統」。
- 社名在報名系統找不到任何報名：回「目前沒有任何報名紀錄」，讓模型明確說沒有。

### System prompt 新增規則

> 凡是問到「報名了嗎、報了誰、繳費了沒、要繳多少、匯款帳號」等與本社報名或繳費有關的問題，一律呼叫 `get_my_club_registration`，不得用知識庫或記憶猜測。使用者若詢問其他社的報名或繳費資料，直接拒絕並說明只能查詢自己社。

## 4. 社名對應

兩邊的社名都來自同一份 `3523地區現有社名排序.xlsx`，RAG 的 `clubs.name` 與報名系統的 `clubName` 字串相同，直接用社名字串比對。階段 2 會寫一支小腳本比對兩邊 80 社名稱是否完全一致，有差異先列出來。

## 5. 環境變數

### RAG（母版 `.env`，同步到 Vercel 專案 `agentic-rag`）

| 變數 | 用途 | 哪裡取得 |
|---|---|---|
| `SIGNUP_SUPABASE_URL` | 報名系統 Supabase 網址 | 報名系統 `index.html` 第 21 行 |
| `SIGNUP_SUPABASE_ANON_KEY` | 報名系統 anon key（可公開的 `sb_publishable_`） | 同上第 22 行 |
| `SIGNUP_STORAGE_KEY` | 主資料 key，預設 `rotary_3523_spa_data_v3` | 不用改 |
| `SIGNUP_PAYMENT_KEY` | 繳費紀錄 key，預設 `rotary_3523_payment_records_v1` | 不用改 |
| `SIGNUP_SITE_URL` | 報名系統網址，回答時可附連結 | `https://3523d.vercel.app` |

### 報名系統（階段 3 先寫在 `index.html` 設定區；階段 5 改成環境變數）

| 變數 | 用途 |
|---|---|
| `RAG_ASSISTANT_URL` | RAG 網址 `https://agentic-rag-dusky.vercel.app`，空字串＝不顯示按鈕 |

## 6. 跳轉與登入

- 按鈕：`window.open(RAG_ASSISTANT_URL + '?club=' + encodeURIComponent(selectedClubName), '_blank')`。
- RAG 登入頁：`new URLSearchParams(location.search).get('club')`，若在 `/api/auth/clubs` 清單內就預選並勾「記住社名」。
- 密碼：兩邊各自獨立。報名系統的社密碼以明文存在對 anon 開放的 `app_storage`，**不適合**拿來做單一登入，所以暫不做 SSO。未來若要同步密碼，應在 RAG 端做，不該反向。

## 7. 安全邊界

- RAG 讀報名資料只用 anon key，只有 GET，程式裡沒有任何 upsert。
- 工具回傳前先過濾成登入社，模型看不到其他社的資料，所以模型也「說不出來」。
- `SIGNUP_*` 金鑰只在 RAG 後端 `.env` 與 Vercel 環境變數，前端程式碼不會出現。
- 速率限制：每社每分鐘 10 次。

## 8. 預估 commit

| 階段 | 專案 | commit |
|---|---|---|
| 2 | RAG | `feat(signup): 新增本社報名查詢工具 get_my_club_registration` |
| 2 | RAG | `docs(env): .env.example 加 SIGNUP_* 說明` |
| 3 | RAG | `feat(auth): 登入頁支援 ?club= 預選社名` |
| 3 | 報名 | `feat: 執秘快捷列新增「AI 小幫手」按鈕，帶社名開啟 RAG` |
| 4 | RAG | `feat(chat): 每社每分鐘 10 次速率限制` |
| 4 | 報名 | `docs: 新增 rag-security-checklist` |
| 5 | 報名 | 2～3 個（設定檔、建置腳本、index.html 改讀設定） |
| 6 | RAG | 2 個（環境變數、種子檔） |
| 7 | 兩邊 | `docs: 測試清單` |

## 9. 還沒決定、需要 Fruit 回答的事

1. 工具要不要連「名單」一起回（每個人的姓名、葷素）？還是只回人數與金額？建議回名單，執秘問「我們社報了誰」才答得出來。
2. 地區管理員（RAG 的「地區管理員」帳號）可以查任何一社，這樣可以嗎？
3. 階段 5 去地區化時，GitHub Pages 這條部署線要不要保留？保留的話建置變數要放 GitHub Secrets，多一個地方要維護。
