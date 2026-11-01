# 國際扶輪 3523 地區活動整合報名系統 (Rotary District 3523 Event Registration SPA)

本專案為國際扶輪 3523 地區年度常態活動之整合報名系統單頁應用程式 (Single Page Application, SPA)，專為扶輪社各社執秘、社長、主委與地區幹部設計，支援各作業系統與行動裝置連動。

---

## ✨ 系統核心功能

1. **✍️ 各社執秘專用工作區**
   - 內建 3523 地區 1~13 分區各扶輪社標準名冊庫。
   - **⛳ 高爾夫差點 (Golf Handicap) 整合庫**：維護社友資料時支援登記 0~54 高爾夫差點，勾選自動帶入報名表，即時動態計算全隊平均差點。
   - 一鍵勾選免重複 Key-in，自動帶入職務、Nick Name、葷素需求。
   - 防竄改社別鎖定機制。
   - **🎁 贊助獎登錄**（運動賽事）：執秘可直接點選本社社友（如總監、地區賽事主委、地區秘書長）登錄贊助獎，可選「現金（填金額）」或「禮品（填名稱）」並勾選是否用餐；勾選用餐者自動列入用餐人數與葷素統計，免餐費、不計入該社應繳總計；同步顯示於 LINE 通報、主委儀表板、名單明細與 Excel 匯出；主委「全部展開（合併 Excel/CSV）」檢視、複製全體名冊與 Excel 另有「全體贊助獎彙整」，不分社集中列出並附合計。

2. **📊 當屆主委戰情儀表板**
   - **🗂️ 收合式面板，新手主委也看得懂**：主委後台與最高權限管理頁的每個區塊預設收合，標題下方一句白話說明「點開可以做什麼」，想看再按「展開」；展開狀態會記在該裝置，另有「全部展開／全部收合」。最上方固定顯示報名人數、葷素、贊助金額、封存狀態四格總覽。
   - 即時報名人數、葷食/素食、贊助累計金額統計。
   - 針對「地區高爾夫球聯誼賽」自動切換選手差點戰情報表。
   - 各社已提交報名明細與出席名單（含差點）一鍵展開檢視。
   - 模擬活動當日 00:00 自動封存唯讀機制。
   - **🧹 正式上線前資料歸零（最高管理員）**：最高權限管理頁提供「清空繳費紀錄」「清空全部報名單」「清空全部社友庫」三顆歸零按鈕，皆需二次確認、清空後所有裝置同步；另有「載入示範資料」供展示用。系統啟動時不再自動生成模擬繳費資料。
   - **🏢 地區辦公室不列入繳費名單**：「地區辦公室」僅供指派為活動主委（地辦人員協助後台），繳費總表、催繳名單、投影模式與 Excel 匯出皆以 80 社計算，不含地區辦公室。
   - **💳 繳費狀況依子活動分開**：各分區各社繳費狀況即時總表以「子活動」為單位各自一張（GMS、DTLS、年會大會…互不影響），應繳金額自動帶入該子活動的「各社應繳金額」；執秘送出報名表不會自動標記為已繳費，由主委手動核訖或貼上銀行通知核對。
   - **🔒 主選單與子活動增刪僅限最高管理員**：「新增/刪除主選單」、「新增/刪除子活動」四個按鈕只有最高管理員登入後才會顯示，活動主委與各社執秘進入時完全看不到，也無法操作。
   - **📎 活動DM（海報／簡章）上傳**：主委在「活動設定與費用金額」面板點開「活動DM」，可上傳 PDF、JPG、PPT／PPTX（每檔最大 20 MB，可多檔），各社執秘在報名頁標題下方會看到「📎 活動DM」連結可開啟或下載；每個子活動各自一組檔案，主委可刪除舊檔。檔案存放於 Supabase Storage（需先依下方「活動 DM 檔案空間設定」建立一次）。
   - **💳 匯款帳號與上海商銀入帳通知自動對帳**：主委在「活動設定與費用金額 → 匯款帳號與入帳通知信箱」填寫匯款帳號、銀行通知信寄達的信箱帳密與通知單 PDF 開啟密碼（戶名統編／身分證末六碼）；執秘在研討會／年會／分攤金的報名頁會看到匯款帳號、應繳金額與「匯款備註請填貴社全名（例：南區扶輪社）」提醒，匯款後填入備註、金額、日期按「我已匯款，送出通知」。雲端小程式每 10 分鐘讀取信箱中的上海商銀「入帳通知單」，解開加密 PDF 附件取出存摺備註與金額，比對後自動標記「已繳費（Email 自動核對）」，執秘端同步顯示「✅ 已收到您的匯款」；主委可按「立即抓取」、檢視所有入帳紀錄，未配對的入帳可手動指定給某社。需先依下方「入帳通知自動對帳設定」完成一次設定。
   - **💰 各子活動獨立費用設定**：參賽選手費、只用餐費、共同主辦社/協辦社/贊助社金額、研習會每社應繳金額、社慶花款與餐費，皆依「子活動」分別儲存，高爾夫、保齡球、各社社慶可各自設定不同金額，互不覆蓋。

3. **📲 跨作業系統與手機行動端連動中心**
   - **動態 QR Code 掃碼**：使用 iPhone / Android 手機直接掃碼即可於行動端瀏覽器開啟。
   - **原生系統分享 (Web Share API)**：一鍵呼叫手機原生選單，直接轉發至 LINE、AirDrop 或各大 App。
   - **💬 LINE 扶輪一鍵通報**：針對台灣扶輪社溝通習慣，一鍵格式化產出出席名冊（含職稱、姓名、Nick Name、葷素、**高爾夫差點**）並直接開啟 LINE 傳送。
   - **📅 行事曆連動 (.ics & Google Calendar)**：支援匯出標準 `.ics` 檔案與一鍵加入 Google 日曆。
   - **💾 跨裝置備份與同步代碼**：本機 LocalStorage 自動持久化保存，支援一鍵產生同步字串代碼跨裝置貼上還原，以及 JSON 備份檔匯出/匯入。
   - **📥 跨平台無亂碼 Excel (CSV)**：採用 UTF-8 BOM (`\uFEFF`) 編碼，徹底根除 Windows 繁體中文 Excel 亂碼問題。
   - **PWA 行動端優化**：支援 iPhone「加入主畫面」全螢幕運行如原生 App。

4. **🔄 生命週期規格與 E-R Schema 檢視**
   - 清楚展示年度換屆資料銜接邏輯（清空當屆報名，但永久留存各社執秘社友資料庫與高爾夫差點）。

---

## 🚀 部署與線上瀏覽 (GitHub Pages)

本專案使用原生 HTML5 / Tailwind CSS (CDN) / Chart.js / QRCode.js 開發，無須後端建置流程，推送到 GitHub 即可透過 **GitHub Pages** 免費發布：

1. 開啟本儲存庫的 **Settings** > **Pages**。
2. 在 **Branch** 選擇 `main`，路徑選擇 `/(root)`，點擊 **Save**。
3. 稍候數秒即可透過網址 `https://<您的帳號>.github.io/<儲存庫名稱>/` 進行全球線上操作與手機連動！

---

## 活動 DM 檔案空間設定（最高管理員只需做一次）

活動 DM 的檔案本體存放在 Supabase Storage 的 bucket `event-dm`。第一次使用前請在 Supabase 後台建立：

1. 登入 https://supabase.com/dashboard ，進入本系統的專案。
2. 左側選單點 **SQL Editor** → **New query**。
3. 貼上下面整段 SQL，按 **Run**：

```sql
-- 建立公開讀取的 bucket「event-dm」，單檔上限 20 MB，只允許 PDF / JPG / PPT / PPTX
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-dm', 'event-dm', true, 20971520,
        array['application/pdf', 'image/jpeg',
              'application/vnd.ms-powerpoint',
              'application/vnd.openxmlformats-officedocument.presentationml.presentation'])
on conflict (id) do update set public = true, file_size_limit = 20971520,
  allowed_mime_types = excluded.allowed_mime_types;

-- 前端用 anon key 直接上傳／讀取／刪除，所以要對 anon 開放 event-dm 這個 bucket
create policy "anon read event-dm"   on storage.objects for select to anon using (bucket_id = 'event-dm');
create policy "anon upload event-dm" on storage.objects for insert to anon with check (bucket_id = 'event-dm');
create policy "anon update event-dm" on storage.objects for update to anon using (bucket_id = 'event-dm');
create policy "anon delete event-dm" on storage.objects for delete to anon using (bucket_id = 'event-dm');
```

4. 看到 `Success` 即完成。回到系統，以主委身分在「活動設定與費用金額 → 活動DM」上傳一個檔案測試。
5. 若上傳時出現「雲端尚未建立 event-dm 儲存空間」或「存取權限尚未開放」的提示，代表上面的 SQL 沒有成功執行，請重新執行一次。

---

## 入帳通知自動對帳設定（最高管理員只需做一次）

這個功能需要三樣東西：① 雲端資料表與排程、② 讀信的雲端小程式、③ 收銀行通知信的信箱帳密與通知單 PDF 的開啟密碼。

### ① 建立資料表與每 10 分鐘排程

1. 開 https://supabase.com/dashboard/project/ncrvmhfggfczicpyebvn/sql/new 。
2. 把專案裡 `supabase/sql/bank_mail_setup.sql` 的整段內容貼上，按 **Run**，看到 Success 即可（可重複執行）。
   它會建立 `bank_transactions`（入帳紀錄，前端可讀）、`bank_mail_settings`（信箱與密碼，**前端只能寫不能讀**，密碼不外洩）、`bank_mail_status`（抓取狀態），並用 pg_cron 每 10 分鐘呼叫一次雲端小程式。

### ② 部署雲端小程式 `fetch-bank-mail`

在這台電腦的終端機（或 Claude Code 對話中用 `!` 開頭）依序執行：

```bash
supabase login                      # 會開瀏覽器登入 Supabase 帳號，登入一次即可
cd "/Users/fruit/Documents/insta360/01扶輪/3523報名表"
supabase link --project-ref ncrvmhfggfczicpyebvn
supabase functions deploy fetch-bank-mail --no-verify-jwt
```

`--no-verify-jwt` 是讓排程與前端都能直接呼叫；這支小程式只會「去讀信並寫入入帳紀錄」，不會回傳任何密碼或私人資料，且 20 秒內重複呼叫會自動略過。

### ③ 填入收通知信的信箱、密碼與 PDF 開啟密碼

上海商銀的入帳通知信**本文沒有金額**，入帳明細放在一個**加密 PDF 附件**裡，開啟密碼是帳戶戶名的「身分證號或統一編號末六碼」。所以後台要填三樣：信箱帳號、信箱密碼、PDF 開啟密碼。

1. 確認上海商銀的入帳通知寄到哪個信箱（網路銀行「服務類 → 電子郵件服務設定」可查看或變更）。
2. 以主委或最高管理員身分進「活動設定與費用金額 → 匯款帳號與入帳通知信箱」：
   - **信箱服務**：HiNet（ms○.hinet.net 結尾的中華電信信箱）直接選 HiNet，密碑用平常登入信箱的密碼即可。
     若是 Gmail：先到 Google 帳戶 → 安全性 → 開啟「兩步驟驗證」，再到 https://myaccount.google.com/apppasswords 建立一組 16 碼「應用程式密碼」，填這組而不是登入密碼。
   - **Email address**、**Email 密碼**。
   - **PDF 開啟密碼**：戶名的身分證號／統一編號末六碼（6 碼數字）。
3. 按「儲存信箱並測試連線」。幾秒後狀態列出現「掃描 N 封，其中銀行通知 N 封，新增入帳 N 筆」且沒有紅字就成功了；「③ 銀行入帳紀錄」會列出最近 60 天所有入帳。
4. 常見紅字：「信箱登入失敗」→ 帳號或密碼打錯；「PDF 開啟密碼錯誤」→ 末六碼不對；「連不上收信主機」→ 信箱服務選錯。
5. **HiNet 信箱要先關掉「海外登入限制」**：雲端小程式在國外的伺服器執行，HiNet 預設不允許非臺灣 IP 登入，會回「LOGIN failed. Invalid login/password.」（明明帳密正確）。到 https://webmail.hinet.net 登入 → 設定 → 環境設定 → 「登入來源限制設定」，把 **POP3/IMAP 的「不允許非臺灣 IP 登入」取消勾選** 後儲存（網頁郵件那一項可維持勾選）。
6. 第一次設定時信箱裡可能已累積幾十封通知，雲端每次只處理 4 封（平台 CPU 限制），按「立即抓取」會自動一輪一輪續抓到做完；之後排程每 10 分鐘抓一次，平常一天幾封不會有這個問題。

### 重新上傳雲端小程式（程式有更新時）

在 Finder 開啟專案資料夾，點兩下 **「部署雲端小程式.command」**，看到 ✅ 上傳成功即可（第一次若被 macOS 擋下，對檔案按右鍵 → 打開）。

### 比對規則（讓主委了解為何有些入帳要手動指定）

- 執秘送出通知時填的「匯款備註」與銀行信上的「存摺備註」完全相同 → 自動配對。
- 銀行備註含有某一社的社名關鍵字（例如「南區」「松山」），且只對得上一個社 → 自動配對（「西南區」不會被「南區」搶走）。
- 執秘填的是至少 5 碼的純數字（例如轉出帳號末碼），而銀行備註包含該數字 → 自動配對。
- 金額若執秘有填，必須與入帳金額一致；日期相差 3 天內。
- 其餘情況（備註空白、亂碼、金額不符）會留在「未配對」，主委在入帳紀錄右側選社別按「指定」即可。
