# AI 小幫手（Agentic RAG）上線前安全檢查清單

> 階段 4 產出。每次要把 RAG 或報名系統推上正式環境前，照這張清單逐項打勾。
> 2026-11-05 第一次盤點結果已填在「目前狀態」欄。

## A. 金鑰與環境變數

| # | 檢查項目 | 怎麼檢查 | 目前狀態 |
|---|---|---|---|
| A1 | 兩個專案的 `.env`、`.env.local` 都不在 git 裡 | `git ls-files \| grep -E '\.env'` 只能看到 `.env.example` | ✅ 兩邊都只有 `.env.example` |
| A2 | git 歷史沒有 commit 過金鑰 | `git log --all --name-only \| grep -E '\.env'` | ✅ 階段 0 確認過 |
| A3 | `SUPABASE_SERVICE_ROLE_KEY`（`sb_secret_`）只出現在伺服器端 | RAG：`grep -rn SERVICE_ROLE backend scripts`；前端 `frontend/src` 必須為空 | ✅ 只在 `backend/app/auth.py`、`config.py`、測試腳本、同步腳本；報名系統只在 Deno 雲端小程式 |
| A4 | RAG 讀報名系統只用 anon key（`sb_publishable_`） | `.env` 的 `SIGNUP_SUPABASE_ANON_KEY` 開頭是 `sb_publishable_` | ✅ |
| A5 | 報名系統 `index.html` 寫死的只有 anon key，沒有 secret | 看第 21–22 行 | ✅ |
| A6 | Vercel 環境變數與本機 `.env` 一致 | 執行「同步環境變數到Vercel.command」 | ⬜ 階段 7 前執行 |

## B. 資料存取邊界

| # | 檢查項目 | 怎麼檢查 | 目前狀態 |
|---|---|---|---|
| B1 | 橋接模組只有讀取、沒有寫入 | `grep -nE 'client\.(post\|patch\|put\|delete)\|upsert\|insert' backend/app/services/signup_bridge.py` 必須為空 | ✅ 只有一個 `client.get` |
| B2 | 一般使用者查不到別社資料 | `backend/tests/e2e_signup_tool.py`「甲社問乙社」兩項 | ✅ 11/11 通過 |
| B3 | 工具回傳給模型的是「單一社」摘要，不是整包 JSON | 看 `summarize_club_registration()` 只篩 `clubName === 登入社` | ✅ |
| B4 | 管理員指定社名查詢只對 `is_admin` 生效 | `execute_signup_registration_tool()` 第一段判斷 | ✅ |
| B5 | 知識庫文件可見性（地區／本社）規則仍生效 | `backend/tests/e2e_module10.py` | ⬜ 階段 7 重跑 |
| B6 | 報名系統 `app_storage` 對 anon 開放全部操作是**既有設計**（前端直接寫入），RAG 沒有讓這件事變得更糟 | 本次沒有新增任何 policy | ✅ 無變更 |

## C. API 防護

| # | 檢查項目 | 怎麼檢查 | 目前狀態 |
|---|---|---|---|
| C1 | 未登入呼叫 `/api/chat/stream` 被拒（401/403） | `curl -X POST .../api/chat/stream` 不帶 token | ✅ `backend/tests/e2e_rate_limit.py` |
| C2 | 每社每分鐘最多 10 次，超過回 429 並附 `Retry-After` | 同上測試（以 `CHAT_RATE_LIMIT_PER_MINUTE=2` 加速驗證） | ✅ |
| C3 | 速率限制在碰資料庫與模型之前就擋下 | `chat_stream()` 開頭即檢查 | ✅ |
| C4 | 登入節流（密碼錯誤多次鎖定）仍有效 | 模組 10 既有 `accounts.check_throttle` | ✅ 未更動 |

## D. 前端與連結

| # | 檢查項目 | 怎麼檢查 | 目前狀態 |
|---|---|---|---|
| D1 | 報名系統 → RAG 的連結只帶「社名」，不帶密碼或 token | `getRagAssistantLink()` | ✅ |
| D2 | 新分頁以 `noopener` 開啟，RAG 頁面拿不到報名系統的 `window` | `window.open(link, '_blank', 'noopener')` | ✅ |
| D3 | RAG 登入頁只用 `?club=` 預選社名，仍要輸入密碼 | `AuthPage.tsx` | ✅ |
| D4 | 兩邊密碼各自獨立，沒有任何一邊把密碼傳給另一邊 | 本次設計 | ✅ |

## E. 上線後

| # | 檢查項目 | 目前狀態 |
|---|---|---|
| E1 | LangSmith 可看到每次工具呼叫（含 `get_my_club_registration`） | ⬜ 階段 8 |
| E2 | 用一個真實社帳號從正式報名系統點按鈕 → 登入 → 問「我們社報名了什麼」 | ⬜ 階段 8 |
| E3 | 用另一社帳號問前者的名單，確認被拒 | ⬜ 階段 8 |

## 已知限制（不是漏洞，但要知道）

- 速率限制是記憶體計數；Vercel 若同時起多個執行個體，每個各算各的，實際上限可能略高於 10。
- 報名系統 `app_storage` 本來就對 anon 可讀可寫，報名系統的社密碼以明文存在裡面。這是報名系統的既有設計，RAG 整合沒有改變它，但也因此**不能**拿它做單一登入。若未來要收緊，需先把報名系統的寫入改走 Edge Function。
