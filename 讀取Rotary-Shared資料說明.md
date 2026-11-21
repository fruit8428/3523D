# 讀取 Rotary-Shared 獎助金資料說明（Edge Functions 版）

> 這份文件是給**扶輪地區活動整合報名系統**（GitHub：`3523D`）的開發者與 Claude Code 看的。
> 使用方式：對 Claude Code 說：
> 「請讀『讀取Rotary-Shared資料說明.md』，幫我在系統裡加上『全球獎助金』查詢功能。」
>
> 本文件已依報名系統的實際架構改寫：靜態網頁（`index.html`）＋ Supabase Edge Functions（雲端小程式），
> 沒有 Vercel 後端、沒有 Supabase Auth。程式範例**尚未在報名系統裡實際執行過**，
> 請以報名系統現有的程式（`supabase/functions/line-checkin/`）與 `CLAUDE.md` 為準，範例只是方向。

最後更新：2026-11-21

> ## ⚠️ 2026-11-21 更新：已改成「公開唯讀」，不再使用私密金鑰
>
> 負責人決定：這份資料本來就是公開資訊，只是翻成中文方便社友查看，所以改成更簡單也更安全的做法。
> **下面第 2 節規則 1、第 3 節（連線設定）、第 5.2 節、第 10 節關於 `sb_secret_` 與 secrets 的內容都已不適用，以這一段為準。**
>
> - `Rotary-Shared` 的 `global_grants` 已開啟 RLS，公開金鑰（anon）**只有 SELECT**：任何人只能讀取，
>   不能新增、修改、刪除，由資料庫本身擋住（SQL：報名系統 repo 的 `supabase/sql/rotary_shared_readonly.sql`；已實測寫入全部被拒）。
> - 報名系統的雲端小程式內建 `Rotary-Shared` 的網址與 **publishable 金鑰**（`sb_publishable_` 開頭，可以公開、可以進 git），
>   各地區**不需要設定任何 secret**，地區設定檔 `grantsEnabled: true` 並部署雲端小程式即可。
> - 要關閉某個地區：`grantsEnabled` 改成 `false`，或在該地區設 secret `GRANTS_DISABLED=1`。
> - **爬蟲不受影響**：照舊用自己的私密金鑰寫入（私密金鑰不受 RLS 限制）。爬蟲那把私密金鑰仍然不可外流。
> - 已知的代價：知道網址與公開金鑰的人可以不經過報名系統、不用社密碼直接讀整張表（含聯絡人 Email）。
>   社密碼只擋報名系統的畫面。
> - **給爬蟲專案的提醒**：之後若在 `Rotary-Shared` 新增其他資料表，預設要開 RLS 且不給 anon 權限，
>   只有確定可以公開的表才比照這個做法開放 SELECT。

---

## 1. 這是什麼

`Rotary-Shared` 是一個獨立的 Supabase 專案，存放**所有扶輪地區共用**的資料。
目前裡面有一張資料表 `global_grants`：全世界扶輪社正在募款的「全球獎助金（Global Grants）」計畫，
資料來源是公開網站 https://www.matchinggrants.org/global/ 。

- 資料由另一個專案（爬蟲，GitHub：`scrapling-crawler`，本機 `/Users/fruit/Documents/AI Agent/Scrapling`）負責抓取、翻譯、寫入。
- 各地區的報名系統**只讀取**這份資料，不寫入、不修改。
- 目前收錄 2026-27 扶輪年度，共 279 個計畫。

### 架構

```
爬蟲（手動執行）──寫入──▶ Rotary-Shared（共用，只有獎助金資料）
                                  ▲
                 只讀取（雲端小程式）│
        ┌─────────────────────────┼─────────────────────────┐
  3523 的 Supabase 專案      3521 的 Supabase 專案       其他地區…
  └ 雲端小程式 line-checkin  └ 雲端小程式 line-checkin
        ▲                          ▲
  index.html（3523 站）      index.html（3521 站）
```

瀏覽器裡的 `index.html` **不會**直接連 `Rotary-Shared`。
它呼叫自己地區的雲端小程式，由雲端小程式拿著私密金鑰去讀 `Rotary-Shared`，再把結果傳回來。

---

## 2. 最重要的四條規則

1. **私密金鑰只能放在雲端小程式的 secrets。**
   報名系統是靜態網站，`index.html`、`district-config.js`、`config/districts/*.json` 裡的內容任何人都下載得到。
   `Rotary-Shared` 的金鑰（`sb_secret_` 開頭）**絕對不可以**寫進這些檔案，也不可以進 git。
   （報名系統自己的 anon key 可以公開，是因為有 RLS 把關；`Rotary-Shared` 的私密金鑰沒有這層保護。）
2. **獎助金資料不可以存進 `app_storage`。**
   `app_storage` 是 anon 可讀的，等於公開。比照旅平險個資與 `line_bindings` 的做法：資料只經過雲端小程式，不落地到公開的表。
3. **聯絡人姓名與 Email 要通過社密碼才能看。**
   負責人已決定（2026-11-21）：這是來源網站上的公開資訊，通過社密碼驗證即可查看，
   清單和詳細頁都直接顯示聯絡人。見第 6 節。
4. **只讀不寫。**
   不要從報名系統新增、修改或刪除 `global_grants` 的資料；下次爬蟲執行時會被覆蓋。
   地區自己的紀錄（收藏、洽談備註）存在地區自己的專案，見第 7 節。

---

## 3. 連線設定

### 3.1 需要的兩個 secrets

設在**各地區自己的 Supabase 專案**（例如 3523 的專案），給雲端小程式用：

| 名稱 | 內容 |
|------|------|
| `ROTARY_SHARED_SUPABASE_URL` | `https://ceqxbzctljutsbvdmgwv.supabase.co` |
| `ROTARY_SHARED_SUPABASE_SECRET_KEY` | 該地區專屬的私密金鑰（`sb_secret_` 開頭） |

名稱刻意加上 `ROTARY_SHARED_`，避免和雲端小程式原本的 `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`（地區自己的資料庫）搞混。

比照現有 `LINE_MESSAGING_ACCESS_TOKEN` 的慣例：**兩個 secret 都有值，這個地區才算開放獎助金功能**；
沒設定時雲端小程式回傳一個固定的錯誤代碼（例如 `GRANTS_NOT_CONFIGURED`），前端顯示「尚未開放」。
要關閉某個地區的功能時，刪掉 secret 即可。

### 3.2 每個地區發一把專屬金鑰（手動操作）

不要讓各地區共用同一把金鑰，也不要沿用爬蟲那一把。這樣某個客戶停用時，只要作廢它那一把。

1. 登入 https://supabase.com/dashboard ，進入 **`Rotary-Shared`** 專案。
2. 左下角齒輪 **Project Settings** → **API Keys**。
3. 在 **Secret keys** 區塊按 **New secret key**。
4. 名稱填地區代號，例如 `rotary-3523`。
5. 複製產生的 `sb_secret_...` 金鑰。

### 3.3 把 secrets 設到地區專案（手動操作，擇一）

**用網頁：**

1. 在 Supabase 後台切換到**該地區的專案**（不是 `Rotary-Shared`）。
2. 左邊選單 **Edge Functions** → **Secrets**。
3. 新增上面兩個 secret，按儲存。

**用指令：**

```bash
supabase secrets set \
  ROTARY_SHARED_SUPABASE_URL=https://ceqxbzctljutsbvdmgwv.supabase.co \
  ROTARY_SHARED_SUPABASE_SECRET_KEY=sb_secret_xxxxxxxx \
  --project-ref <該地區專案的代號>
```

設定或修改 secret 後，雲端小程式要重新部署才會讀到新值。

### 3.4 要知道的限制

Supabase 的私密金鑰權限是「可讀可寫全部資料」，沒辦法設成唯讀。
「只讀不寫」目前是靠程式自我約束，不是靠資料庫擋住。
這在「所有地區系統都由同一個團隊開發維護」的前提下可以接受；
如果未來要把金鑰交給外部團隊，需要改成唯讀的做法，屆時再調整。

---

## 4. 資料表 `global_grants` 欄位

一個計畫一筆，主鍵是 `project_id`。

### 基本資料

| 欄位 | 型別 | 說明 | 範例 |
|------|------|------|------|
| `project_id` | text | 計畫編號（主鍵） | `G-4151` |
| `rotary_year` | text | 扶輪年度 | `2026-27` |
| `title` | text | 計畫名稱（英文；來源網站限制 30 字，可能被截短） | `Yakkhagaun Water Project` |
| `country` / `country_zh` | text | 國家（英文／中文） | `Nepal` / `尼泊爾` |
| `location` | text | 地點（英文） | `Illam` |
| `region` / `region_zh` | text | 區域（英文／中文） | `Asia` / `亞洲` |
| `areas_of_focus` / `areas_of_focus_zh` | text | 服務重點，可能有多個 | `Water, sanitation and hygiene` / `水資源、衛生設施與個人衛生` |
| `description` | text | 計畫說明（英文全文） | |
| `description_zh` | text | 計畫說明（ChatGPT 翻譯的繁體中文） | |
| `detail_url` | text | 來源網站的詳細頁網址 | |

### 金額與狀態

| 欄位 | 型別 | 說明 | 範例 |
|------|------|------|------|
| `total_budget` | integer | 總金額（美元） | `166475` |
| `status` / `status_zh` | text | 狀態（英文／中文） | `Need $165,475` / `尚缺 $165,475` |
| `remaining_amount` | integer | 尚缺金額（美元）；已足額為 `0` | `165475` |
| `trf_requested` | integer | 向扶輪基金會申請金額 | `0` |
| `pledge_count` | integer | 已認捐筆數 | `1` |
| `pledges` | jsonb | 已認捐明細（陣列，見下方） | |

狀態共六種：`Need $金額`（尚缺）、`Fully Pledged`（已足額認捐）、`Application Sent`（已送出申請）、
`Approved`（已核准）、`Paid`（已撥款）、`Completed`（已完成）。
**判斷「還在募款中」請用 `remaining_amount > 0`**，不要去比對狀態文字。

`pledges` 的每一筆長這樣（**鍵名是中文**）：

```json
{ "認捐社": "Kololo-Kampala", "地區": "9213", "日期": "2026-02-01", "現金": 37400, "DDF": 10000, "合計": 47400 }
```

`DDF` 是「地區指定用途基金」。認捐者是地區本身時，`認捐社` 會是 `District 6600 DDF` 這種寫法。

### 夥伴社

| 欄位 | 型別 | 說明 | 範例 |
|------|------|------|------|
| `district` | text | 主辦社所屬地區 | `3292` |
| `host_club` | text | 主辦扶輪社名稱 | `Dhulikhel Shikhalapur` |
| `host_partner` | text | 主辦夥伴社＋地區 | `Rotary Club of Dhulikhel Shikhalapur, District 3292` |
| `intl_partner` | text | 國際夥伴社＋地區；還沒有時是空字串 | `Rotary Club of Boulder, District 5450` |
| `intl_partner_district` | text | 國際夥伴社所屬地區；還沒有時是空字串 | `5450` |

地區號碼都是**文字**（text），比對時請用字串 `'3523'`，不要用數字。

### 聯絡人（個資：通過社密碼後，清單與詳細頁都回傳）

| 欄位 | 型別 | 說明 |
|------|------|------|
| `host_contact_name` | text | 主辦聯絡人姓名 |
| `host_contact_email` | text | 主辦聯絡人 Email |
| `intl_contact_name` | text | 國際夥伴聯絡人姓名（沒有夥伴社時為空字串） |
| `intl_contact_email` | text | 國際夥伴聯絡人 Email（可能為空字串） |

### 追蹤用

| 欄位 | 型別 | 說明 |
|------|------|------|
| `listed_date` | date | 計畫在來源網站的上架日期 |
| `first_seen` | date | 爬蟲第一次抓到的日期 |
| `last_changed` | date | 狀態或金額最後一次變動的日期 |
| `removed_from_list` | date | 計畫從來源網站清單消失的日期；還在就是 `null` |
| `updated_at` | timestamptz | 這筆資料最後寫入的時間（可用來顯示「資料更新於…」） |

### 空值的慣例

- 文字欄位沒有資料時是**空字串** `''`，不是 `null`。
- 日期欄位沒有資料時是 `null`。
- 顯示計畫清單時，建議排除 `removed_from_list` 不是 `null` 的計畫。

---

## 5. 實作方式（Supabase Edge Functions）

### 5.1 放在哪裡：沿用 `line-checkin` 的轉送慣例

報名系統現有的做法是：`supabase/functions/line-checkin/lib.ts` 的 `handle(body, deps)` 依動作名稱轉送，
例如 `cal_*` 交給 `calendar.ts`、`club_dues_*` 交給 `dues.ts`，社密碼用 `checkClubPassword()` 把關。

建議照同樣方式：

- 新增 `supabase/functions/line-checkin/grants.ts`，放獎助金的查詢邏輯。
- 在 `lib.ts` 的 `handle()` 加一段，把 `grants_*` 動作轉送過去。
- 連到 `Rotary-Shared` 的 client 放進 `Deps`（和 `admin` 並列），這樣本機測試可以換成假的，跑同一份邏輯。
- 前端沿用 `lineBindingsApi(action, extra)` 呼叫（它會自動帶上社名與社密碼）。

如果讀過現有程式後認為另開一支獨立的小程式（例如 `global-grants`）比較乾淨，也可以；
但身分驗證邏輯不要複製一份，要和 `line-checkin` 共用。

### 5.2 建立連線（`index.ts`）

```ts
// supabase/functions/line-checkin/index.ts（節錄）
import { createClient } from "npm:@supabase/supabase-js@2";

// Rotary-Shared 的連線：兩個 secret 都有值才建立，否則是 null（＝這個地區未開放獎助金）
const SHARED_URL = (Deno.env.get("ROTARY_SHARED_SUPABASE_URL") || "").trim();
const SHARED_KEY = (Deno.env.get("ROTARY_SHARED_SUPABASE_SECRET_KEY") || "").trim();
const shared = SHARED_URL && SHARED_KEY
  ? createClient(SHARED_URL, SHARED_KEY, { auth: { persistSession: false } })
  : null;

const deps: Deps = {
  admin,
  shared,   // 新增：傳給 grants.ts 使用
  // …其餘維持原樣
};
```

### 5.3 查詢邏輯（`grants.ts`）

> 下面的查詢條件都已用 Python 版的 Supabase 套件對真實資料測試過，結果正確。
> TypeScript 的寫法是照同樣條件改寫，尚未實際執行。

```ts
// supabase/functions/line-checkin/grants.ts（範例）
import { AppError } from "./lib.ts";

// 清單要用的欄位：不含長篇說明（太長），含聯絡人姓名與 Email（負責人決定清單上直接顯示）
const LIST_COLUMNS =
  "project_id,title,country,country_zh,region_zh,areas_of_focus_zh,district,host_club," +
  "total_budget,status_zh,remaining_amount,intl_partner,intl_partner_district,listed_date," +
  "host_contact_name,host_contact_email,intl_contact_name,intl_contact_email";

// 詳細頁要用的欄位：清單的欄位，再加上長篇說明與認捐明細
const DETAIL_COLUMNS = LIST_COLUMNS +
  ",rotary_year,location,region,areas_of_focus,status,description,description_zh," +
  "host_partner,pledges,pledge_count,trf_requested,detail_url,last_changed,updated_at";

export async function grantsHandle(action: string, body: any, shared: any) {
  if (!shared) throw new AppError("GRANTS_NOT_CONFIGURED");

  // ---- 清單（可帶篩選）----
  if (action === "grants_list") {
    let q = shared.from("global_grants").select(LIST_COLUMNS).is("removed_from_list", null);

    if (body.onlyOpen) q = q.gt("remaining_amount", 0);                      // 只看還在募款的
    if (typeof body.country === "string" && body.country) q = q.eq("country", body.country);
    if (typeof body.focus === "string" && body.focus) q = q.ilike("areas_of_focus_zh", `%${safeText(body.focus)}%`);
    if (typeof body.keyword === "string" && body.keyword) {
      const k = safeText(body.keyword);
      q = q.or(`title.ilike.%${k}%,description_zh.ilike.%${k}%`);
    }

    const { data, error } = await q.order("listed_date", { ascending: false });
    if (error) throw new AppError("GRANTS_READ_FAILED");
    return { ok: true, grants: data };
  }

  // ---- 和本地區有關的計畫 ----
  if (action === "grants_related") {
    const district = String(body.district || "");
    if (!/^\d{3,5}$/.test(district)) throw new AppError("GRANTS_BAD_DISTRICT");   // 只接受數字

    // 角色一、二：主辦社或國際夥伴社屬於這個地區
    const partner = await shared.from("global_grants").select(LIST_COLUMNS)
      .or(`district.eq.${district},intl_partner_district.eq.${district}`);
    // 角色三：這個地區有認捐。pledges 是 JSON 陣列，篩選值要轉成 JSON 字串，鍵名是中文「地區」
    const donor = await shared.from("global_grants").select(LIST_COLUMNS)
      .filter("pledges", "cs", JSON.stringify([{ "地區": district }]));
    if (partner.error || donor.error) throw new AppError("GRANTS_READ_FAILED");

    return { ok: true, asPartner: partner.data, asDonor: donor.data };
  }

  // ---- 單一計畫 ----
  if (action === "grants_get") {
    const id = String(body.projectId || "");
    if (!/^G-\d+$/.test(id)) throw new AppError("GRANTS_BAD_ID");
    const { data, error } = await shared.from("global_grants")
      .select(DETAIL_COLUMNS).eq("project_id", id).maybeSingle();
    if (error) throw new AppError("GRANTS_READ_FAILED");
    if (!data) throw new AppError("GRANTS_NOT_FOUND");
    return { ok: true, grant: data };
  }

  throw new AppError("UNKNOWN_ACTION");
}

// 使用者輸入的文字要放進 .or() / .ilike() 之前先清掉特殊符號，
// 避免逗號、括號、百分比符號改變查詢條件
function safeText(text: string) {
  return text.replace(/[,()%*\\]/g, " ").trim().slice(0, 50);
}
```

`AppError` 的實際建構方式與錯誤代碼命名，請照 `lib.ts` 現有的寫法調整。

### 5.4 在 `lib.ts` 轉送

```ts
// lib.ts 的 handle() 裡，比照 club_dues_* 的寫法（先驗證身分，再轉送）
if (action.startsWith("grants_")) {
  const club = String(body.club || "");
  checkClubPassword(deps, state, club, body.clubPassword);   // 身分把關，見第 6 節
  return await grantsHandle(action, body, deps.shared);
}
```

### 5.5 前端呼叫（`index.html`）

```js
// 沿用現有的 lineBindingsApi：自動帶上 action、社名、社密碼
const r = await lineBindingsApi('grants_list', { onlyOpen: true, country: 'Nepal' });
if (!r.ok) { /* 依 r.code 顯示錯誤，見第 6 節 */ }

// 和本地區有關的計畫：地區代號用設定檔的 DISTRICT.code，不要寫死 3523
const related = await lineBindingsApi('grants_related', { district: DISTRICT.code });
```

顯示資料時，所有欄位都要經過現有的 `escapeHtmlText()` 再放進 HTML：
`title`、`description` 等內容來自外部網站，是任何人都能填寫的文字。

### 5.6 筆數與效能

- 目前 279 筆，清單可以一次取完。Supabase 單次查詢預設上限是 1000 筆，
  之後收錄多個年度、超過 1000 筆時，要改用 `.range(起, 迄)` 分頁（報名系統讀報到紀錄時已有同樣做法）。
- 清單不要取 `description`、`description_zh`（單筆最長約 28,000 字），點進詳細頁才取。
- 資料不常變動，前端可以把清單結果暫存在記憶體，不必每次切換畫面都重新讀取；
  但**不要**存進 `localStorage` 或 `app_storage`。

### 5.7 地區開關

比照 `calendarEnabled`：在 `config/districts/<代號>.json` 加一個 `grantsEnabled`（→ `DISTRICT.grantsEnabled`），
為 `true` 才顯示入口。改完要執行 `node scripts/build-config.js` 重新產生 `district-config.js`，3523 版要一起 commit。
`config/districts/_template.json` 也要補上這個欄位。

真正的把關仍在雲端小程式（secrets 有沒有設定）；設定檔的開關只決定畫面顯不顯示。

### 5.8 匯出 Excel

通過社密碼的使用者可以把**目前篩選出來的計畫**匯出成 Excel 檔，內容含聯絡人。

**做法：**

- 在前端產生檔案，用 `index.html` 已經載入的 SheetJS（Excel 匯入行程的功能已在使用），不需要新增套件。
- 清單沒有取長篇說明，所以匯出時另外呼叫一個動作（例如 `grants_export`），
  帶上和畫面相同的篩選條件，由雲端小程式回傳完整欄位（`DETAIL_COLUMNS`）。
  `grants_export` 和其他動作一樣要先通過社密碼。
- 篩選邏輯要和 `grants_list` 共用同一段程式，確保「畫面上看到幾筆，就匯出幾筆」。

**欄位與中文標題**（順序比照爬蟲產出的 Excel，方便兩邊對照）：

| Excel 欄位標題 | 資料來源 |
|------|------|
| 計畫編號 | `project_id` |
| 計畫名稱 | `title` |
| 國家 | `country_zh` |
| 地點 | `location` |
| 地區 | `district` |
| 主辦扶輪社 | `host_club` |
| 總金額 | `total_budget`（數字） |
| 狀態 | `status_zh` |
| 尚缺金額 | `remaining_amount`（數字） |
| 詳細頁網址 | `detail_url` |
| 區域 | `region_zh` |
| 服務重點 | `areas_of_focus_zh` |
| 計畫說明 | `description` |
| 計畫說明（中文） | `description_zh` |
| 主辦夥伴社 | `host_partner` |
| 國際夥伴社 | `intl_partner` |
| 國際夥伴地區 | `intl_partner_district` |
| 已認捐明細 | `pledges`（轉成文字，一筆一行，見下方） |
| 已認捐筆數 | `pledge_count`（數字） |
| 向扶輪基金會申請金額 | `trf_requested`（數字） |
| 上架日期 | `listed_date` |
| 主辦聯絡人 | `host_contact_name` |
| 主辦聯絡Email | `host_contact_email` |
| 國際夥伴聯絡人 | `intl_contact_name` |
| 國際夥伴聯絡Email | `intl_contact_email` |

**細節：**

- `pledges` 是陣列，Excel 一格放不下，要轉成一筆一行的文字，格式比照爬蟲：
  `認捐社｜地區 9213｜2026-02-01｜$47,400`。
- 金額欄位要以**數字**寫入（不要轉成文字），使用者才能在 Excel 裡加總、排序。
- 檔名建議：`全球獎助金_<年度>_<今天日期>.xlsx`，例如 `全球獎助金_2026-27_2026-11-21.xlsx`。
- 第一列是欄位標題；可以的話凍結第一列並調整欄寬。
- 計畫說明最長約 28,000 字，Excel 單一儲存格上限是 32,767 字，目前不會超過；
  保險起見超過時截斷並在結尾加上「…（內容過長，請至原始網站查看）」。
- 匯出的檔案在使用者自己的電腦上產生，**不要**上傳或存到任何雲端位置。
- 匯出按鈕旁建議加一行小字：「聯絡資訊僅供洽談合作使用，請勿用於群發信件」。

---

## 6. 身分把關

報名系統沒有使用 Supabase Auth，現有的身分有三種：社密碼（執秘）、最高管理員、LINE 綁定（idToken）。

### 6.1 一律用社密碼把關

所有 `grants_*` 動作都先通過**社密碼**驗證（`checkClubPassword`，和社費通知、綁定名單同一做法）才回傳資料。
最高管理員若沿用同一個呼叫方式，也要能通過。

### 6.2 聯絡人姓名與 Email

**負責人的決定（2026-11-21）：通過社密碼即可查看聯絡人，清單和詳細頁都直接顯示。**
理由：這些聯絡資訊在來源網站上本來就是公開的，目的是方便社友聯繫對方洽談合作。

實作時請注意：

- 報名系統的 `CLAUDE.md` 記載：`clubPasswords` 存在 `app_storage`、公開可讀（已知並接受的風險）。
  所以社密碼的保護力有限，這一點負責人已知悉並接受。
- 聯絡人資料只經過雲端小程式傳給已通過社密碼的畫面，
  **不要**存進 `app_storage`、`localStorage`，也不要寫進任何紀錄檔。
- 畫面上 Email 做成 `mailto:` 連結，方便社友直接寫信。
- 清單在手機上欄位多，聯絡人可以放在每筆計畫的第二行或展開區，避免橫向捲動。
- **要做「匯出 Excel」**（負責人於 2026-11-21 決定），內容含聯絡人，做法見第 5.8 節。
- 「一鍵寄信給所有聯絡人」目前**沒有要做**；若之後有需求，先向負責人確認再實作
  （整批寄信容易被當成濫發信件）。

### 6.3 錯誤處理

比照現有慣例：雲端小程式一律回傳 HTTP 200 與 `{ ok: false, code: '…' }`，前端用對照表轉成中文訊息。建議的代碼：

| 代碼 | 意思 | 給使用者看的訊息 |
|------|------|------|
| `GRANTS_NOT_CONFIGURED` | 這個地區沒有設定 secrets | 本地區尚未開放全球獎助金查詢 |
| `GRANTS_READ_FAILED` | 連不上 `Rotary-Shared` 或查詢失敗 | 獎助金資料暫時無法讀取，請稍後再試 |
| `GRANTS_NOT_FOUND` | 查無此計畫 | 找不到這個計畫，可能已從來源網站移除 |
| `GRANTS_BAD_ID` / `GRANTS_BAD_DISTRICT` | 輸入格式不對 | 查詢條件不正確 |

`Rotary-Shared` 出問題時，只有獎助金頁面受影響，報名、報到、行事曆等功能要照常運作。
不要把原始錯誤訊息（可能含網址或金鑰片段）傳給前端。

---

## 7. 地區自己的資料放哪裡

「我們地區有興趣的計畫」「洽談備註」「誰負責聯絡」這類紀錄，**存在地區自己的 Supabase 專案**，
用 `project_id`（例如 `G-4151`）對應到獎助金資料。

比照 `calendar_events`、`line_bindings` 的做法：新建獨立的資料表、RLS 開啟、不建立 policy（anon 完全讀不到），
讀寫一律經過雲端小程式。**不要放進 `app_storage`**（整包覆寫會互蓋，而且公開可讀）。範例：

```sql
-- supabase/sql/grant_notes.sql —— 在各地區自己的專案執行，不是 Rotary-Shared
create table if not exists public.grant_notes (
  id          bigint generated always as identity primary key,
  project_id  text not null,           -- 對應 Rotary-Shared 的 global_grants.project_id
  club_name   text not null,           -- 哪一社記錄的（認人方式同 LINE 報到：社名）
  status      text,                    -- 例如：有興趣／洽談中／已認捐／不考慮
  note        text,
  created_at  timestamptz default now()
);
alter table public.grant_notes enable row level security;   -- 不建 policy：只有雲端小程式（service_role）能讀寫
```

兩邊是不同的資料庫，沒辦法用 SQL 直接合併查詢。
做法是在雲端小程式裡先從地區專案取出 `project_id` 清單，再用 `.in("project_id", [...])` 到 `Rotary-Shared` 取計畫內容。

---

## 8. 資料多久更新一次

- 資料**不是自動更新**的。來源網站變動不頻繁，由管理者在需要時手動執行爬蟲。
- 每次執行會更新狀態、金額、認捐明細，並加入新計畫；已存在的計畫不會重複。
- 畫面上建議顯示「資料更新於 YYYY-MM-DD」，讓使用者知道資料的新舊。取得方式：

  ```ts
  const { data } = await shared.from("global_grants")
    .select("updated_at").order("updated_at", { ascending: false }).limit(1);
  ```

- 需要最新資料時，請聯絡系統管理者執行更新。

---

## 9. 內容上的注意事項

- **中文說明是機器翻譯**（ChatGPT），沒有逐篇人工校對。建議在畫面上註明「中文為機器翻譯，僅供參考」，
  並提供切換看英文原文的方式。人名、扶輪社名、小地名刻意保留英文。
- **計畫名稱可能被截短**：來源網站限制 30 個字。
- **少數計畫說明是空的或無意義內容**：那是來源網站上填寫者的問題。
- **目前沒有和台灣有關的計畫**：截至 2026-11-21，2026-27 年度沒有任何計畫的主辦社、國際夥伴社或認捐社
  屬於台灣的扶輪地區（含 3523、3521）。「和本地區有關的計畫」一開始會是空的，請設計好空白時的畫面。
- 每個計畫都有 `detail_url`，建議提供「前往原始網站」的連結；認捐等動作要到原網站進行。

---

## 10. 交付前檢查

**安全**

- [ ] 在整個 repo 搜尋 `sb_secret`，確認沒有出現在任何檔案裡（`index.html`、`district-config.js`、`config/`、測試腳本）
- [ ] 獎助金資料沒有寫進 `app_storage` 或 `localStorage`
- [ ] 不帶社密碼或帶錯密碼呼叫 `grants_*`，會被拒絕
- [ ] 聯絡人資料沒有寫進 `app_storage`、`localStorage` 或紀錄檔
- [ ] 聯絡人在清單與詳細頁都正確顯示；沒有夥伴社或沒留 Email 的計畫顯示為空白而不是錯誤
- [ ] 外部來源的文字都有經過 `escapeHtmlText()`

**功能**

- [ ] `node extract_js.js && node -c test.js` 通過（一個語法錯誤就會整站白畫面）
- [ ] 比照 `supabase/tests/` 的做法，用假的 `deps.shared` 測試 `grants.ts` 的各個動作與錯誤情況
- [ ] 新增一支 `check_grants.js` 瀏覽器冒煙測試（清單、篩選、詳細頁、空白畫面、匯出 Excel）
- [ ] 匯出的 Excel：筆數和畫面篩選結果相同、金額是數字、中文正常、聯絡人欄位有內容
- [ ] 不帶社密碼呼叫 `grants_export` 會被拒絕
- [ ] 把 secrets 拿掉後，畫面顯示「尚未開放」，其他功能不受影響
- [ ] 手機上能正常使用

**部署**

- [ ] 兩個 secrets 已設到該地區的 Supabase 專案
- [ ] `supabase functions deploy line-checkin --no-verify-jwt` 已重新部署
- [ ] 3521 等其他地區要各自設定 secrets（各用自己的專屬金鑰）並部署；3521 站是 CLI 部署
- [ ] `config/districts/_template.json` 已補上 `grantsEnabled`
- [ ] `README.md`（給客戶看的功能說明）與 `CLAUDE.md` 已同步更新
- [ ] push 後，GitHub Pages 與 Vercel 兩個網址都確認已更新
