// =====================================================================
// 雲端小程式：LINE 自助報到（綁定 LINE 帳號、掃 QR Code 報到、執秘管理本社綁定）
// 核心邏輯在 lib.ts；這個檔案只負責接上「真正的 LINE 身分驗證」與資料庫連線。
// 部署：supabase functions deploy line-checkin --no-verify-jwt
// 需要的 secrets：
//   LINE_LOGIN_CHANNEL_ID   LINE Login 頻道的 Channel ID（LIFF 所屬的頻道；不是密碼，但必須由伺服器端固定）
//   DEFAULT_CLUB_PASSWORD   （選填）地區的各社預設密碼，與地區設定檔的 defaultClubPassword 相同
//   CALENDAR_ADMIN_PASSWORD （選填）行事曆後台（admin-calendar.html）的密碼；沒設定＝後台關閉
//   LINE_MESSAGING_ACCESS_TOKEN、LINE_PUSH_PASSWORD   （選填）LINE 推播用：官方帳號 Messaging API 的 Channel access token
//                           與推播密碼。兩個都有設定，這個地區才算「開放推播」；系統管理者要關閉時把它們刪掉即可。
//                           總監每日推播（cal_cron_digest）只需要 token；它由資料庫排程呼叫，用 calendar_settings.cron_secret 把關。
//   PHOTO_GITHUB_TOKEN      （選填）活動照片找人：啟動相片專案 GitHub Actions 的 token（PHOTO_GITHUB_REPO／_WORKFLOW／_REF 可改預設值）
//   LINE_MESSAGING_CHANNEL_SECRET、LINE_LIFF_ID   （選填）聊天室關鍵字回覆（Webhook）：官方帳號 Messaging API 的 Channel secret
//                           （用來驗證訊息真的來自 LINE）與地區的 LIFF ID。Webhook URL＝這支小程式的網址。
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { AppError, handle, handleWebhook, verifyLineSignature, type Deps } from "./lib.ts";
import { icsFeed } from "./calendar.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CHANNEL_ID = (Deno.env.get("LINE_LOGIN_CHANNEL_ID") || "").trim();
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });

const PUSH_TOKEN = (Deno.env.get("LINE_MESSAGING_ACCESS_TOKEN") || "").trim();
const lineApi = async (path: string, init?: RequestInit) => {
  const res = await fetch("https://api.line.me" + path, { ...init, headers: { ...(init && init.headers), Authorization: `Bearer ${PUSH_TOKEN}`, "Content-Type": "application/json" } });
  const text = await res.text();
  if (!res.ok) throw new Error(`LINE ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
};

const CHANNEL_SECRET = (Deno.env.get("LINE_MESSAGING_CHANNEL_SECRET") || "").trim();
// 共用專案 Rotary-Shared（全球獎助金）。global_grants 已設成「公開唯讀」（RLS 開啟、anon 只有 SELECT，見 supabase/sql/rotary_shared_readonly.sql），
// 所以這裡用的是可以公開的 publishable 金鑰：只能讀、不能寫（由資料庫擋住）。不要換成 sb_secret_ 的私密金鑰。
// 要關閉某個地區的獎助金查詢：在那個地區設 secret GRANTS_DISABLED=1（或把地區設定檔的 grantsEnabled 改成 false 隱藏按鈕）。
// 兩個 ROTARY_SHARED_* secret 只在共用專案搬家或換金鑰時才需要設定，平常用下面的預設值。
const SHARED_URL = (Deno.env.get("ROTARY_SHARED_SUPABASE_URL") || "https://ceqxbzctljutsbvdmgwv.supabase.co").trim();
const SHARED_KEY = (Deno.env.get("ROTARY_SHARED_SUPABASE_KEY") || "sb_publishable_zw-9bf0JhQausCpaVHOS6Q_eLz8l01-").trim();
const GRANTS_OFF = /^(1|true|yes)$/i.test((Deno.env.get("GRANTS_DISABLED") || "").trim());
const shared = !GRANTS_OFF && SHARED_URL && SHARED_KEY && !/^sb_secret_/.test(SHARED_KEY)
  ? createClient(SHARED_URL, SHARED_KEY, { auth: { persistSession: false } }) : null;
// 活動照片找人：人臉比對在相片專案的 GitHub Actions 執行。貼上連結時由這裡呼叫 GitHub「啟動那個工作流程」。
// PHOTO_GITHUB_TOKEN 只需要該倉庫的 Actions 讀寫權限（fine-grained token）；沒設定＝工作只會排著，等運算程式自己來接。
const GH_TOKEN = (Deno.env.get("PHOTO_GITHUB_TOKEN") || "").trim();
const GH_REPO = (Deno.env.get("PHOTO_GITHUB_REPO") || "fruit8428/photo-finder").trim();
const GH_WORKFLOW = (Deno.env.get("PHOTO_GITHUB_WORKFLOW") || "match.yml").trim();
const GH_REF = (Deno.env.get("PHOTO_GITHUB_REF") || "master").trim();     // photo-finder 的預設分支是 master
const deps: Deps = {
  admin,
  photoDispatch: GH_TOKEN ? async (inputs: Record<string, string>) => {
    const res = await fetch(`https://api.github.com/repos/${GH_REPO}/actions/workflows/${GH_WORKFLOW}/dispatches`, {
      method: "POST",
      headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "rotary-registration", "Content-Type": "application/json" },
      body: JSON.stringify({ ref: GH_REF, inputs }),
    });
    if (!res.ok) throw new Error(`GitHub ${res.status}`);      // 不記錄回應內容
  } : undefined,
  shared,
  liffId: (Deno.env.get("LINE_LIFF_ID") || "").trim(),
  async reply(replyToken: string, messages: unknown[]) {
    await lineApi("/v2/bot/message/reply", { method: "POST", body: JSON.stringify({ replyToken, messages }) });
  },
  calendarAdminPassword: (Deno.env.get("CALENDAR_ADMIN_PASSWORD") || "").trim(),
  push: {
    token: PUSH_TOKEN,
    password: (Deno.env.get("LINE_PUSH_PASSWORD") || "").trim(),
    // 一次最多 500 人；只有一人時用 push，多人用 multicast（計費方式相同：送達幾人算幾則）
    async send(userIds: string[], text: string) {
      const messages = [{ type: "text", text }];
      if (userIds.length === 1) await lineApi("/v2/bot/message/push", { method: "POST", body: JSON.stringify({ to: userIds[0], messages }) });
      else await lineApi("/v2/bot/message/multicast", { method: "POST", body: JSON.stringify({ to: userIds, messages }) });
    },
    // 傳送任意訊息（總監每日推播的 Flex 卡片）給一個人
    async sendMessages(to: string, messages: unknown[]) {
      await lineApi("/v2/bot/message/push", { method: "POST", body: JSON.stringify({ to, messages }) });
    },
    // 傳給官方帳號的所有好友（計費：有幾位好友收得到就算幾則）
    async broadcast(text: string) {
      await lineApi("/v2/bot/message/broadcast", { method: "POST", body: JSON.stringify({ messages: [{ type: "text", text }] }) });
    },
    // 好友人數：LINE 只提供「前一天」的統計（日本時間），帳號剛建立或統計還沒出來時查不到
    async friends() {
      for (const back of [1, 2]) {
        const d = new Date(Date.now() + 9 * 3600_000 - back * 86400_000).toISOString().slice(0, 10).replace(/-/g, "");
        const r = await lineApi(`/v2/bot/insight/followers?date=${d}`);
        if (r.status === "ready") return Number(r.targetedReaches ?? r.followers) || 0;
      }
      return null;
    },
    async quota() {
      const q = await lineApi("/v2/bot/message/quota");
      const c = await lineApi("/v2/bot/message/quota/consumption");
      return { limit: q.type === "limited" ? Number(q.value) : null, used: Number(c.totalUsage) || 0 };
    },
  },
  defaultClubPassword: (Deno.env.get("DEFAULT_CLUB_PASSWORD") || "").trim(),
  // 向 LINE 驗證 idToken：LINE 會檢查簽章、有效期限，以及這個 token 是不是發給我們這個頻道的
  async verify(idToken: string) {
    if (!CHANNEL_ID) throw new AppError("LINE_NOT_CONFIGURED");
    if (!idToken) throw new AppError("LINE_TOKEN_INVALID");
    const res = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: idToken, client_id: CHANNEL_ID }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.sub) {
      const desc = String(j.error_description || j.error || "");
      throw new AppError(/expired/i.test(desc) ? "LINE_TOKEN_EXPIRED" : "LINE_TOKEN_INVALID", desc);
    }
    return { sub: String(j.sub), name: String(j.name || "") };
  },
  // 通知開著報名系統的電腦「報名資料變了」（社友在 LINE 自己報名／取消後；頻道與事件名稱同 index.html 的 notifyLiveSyncPeers）
  async liveSync() {
    await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ messages: [{ topic: "rotary-live-sync", event: "changed", payload: { kind: "line" } }] }),
    });
  },
  // 通知櫃台報到頁（Realtime 廣播頻道 rotary-checkin）
  async broadcast(eventKey: string) {
    await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ messages: [{ topic: "rotary-checkin", event: "changed", payload: { key: eventKey, kind: "mark" } }] }),
    });
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  // 手機行事曆訂閱（.ics）：iPhone／Google 日曆會直接用 GET 抓取，不能帶登入資訊，靠網址裡的隨機 token 認人
  if (req.method === "GET") {
    const token = new URL(req.url).searchParams.get("ics") || "";
    try {
      const ics = await icsFeed(admin, token);
      if (!ics) return new Response("訂閱網址無效或已關閉", { status: 404, headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" } });
      return new Response(ics, { status: 200, headers: { ...CORS, "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-store" } });
    } catch (e) {
      console.error("ics 發生錯誤", e);
      return new Response("系統忙碌中，請稍後再試", { status: 500, headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" } });
    }
  }
  // LINE 官方帳號的 Webhook（有 x-line-signature 標頭）：先驗證簽章，再處理聊天室訊息
  const sig = req.headers.get("x-line-signature");
  if (sig !== null) {
    const raw = await req.text();
    if (!(await verifyLineSignature(CHANNEL_SECRET, raw, sig))) return new Response("bad signature", { status: 401, headers: CORS });
    try {
      const body = JSON.parse(raw || "{}");
      const r = await handleWebhook(body.events || [], deps);
      if (r.replied) console.log("聊天室回覆", JSON.stringify(r));
    } catch (e) { console.error("Webhook 發生錯誤", e); }
    return new Response("ok", { status: 200, headers: CORS });     // 一律回 200，LINE 才不會一直重送
  }
  try {
    const body = await req.json().catch(() => ({}));
    return json(await handle(body, deps));
  } catch (e) {
    if (e instanceof AppError) return json({ ok: false, code: e.code });   // 不把內部訊息回傳給前端
    console.error("line-checkin 發生錯誤", e);
    return json({ ok: false, code: "SERVER_ERROR" });
  }
});
