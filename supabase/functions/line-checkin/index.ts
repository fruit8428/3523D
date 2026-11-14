// =====================================================================
// 雲端小程式：LINE 自助報到（綁定 LINE 帳號、掃 QR Code 報到、執秘管理本社綁定）
// 核心邏輯在 lib.ts；這個檔案只負責接上「真正的 LINE 身分驗證」與資料庫連線。
// 部署：supabase functions deploy line-checkin --no-verify-jwt
// 需要的 secrets：
//   LINE_LOGIN_CHANNEL_ID   LINE Login 頻道的 Channel ID（LIFF 所屬的頻道；不是密碼，但必須由伺服器端固定）
//   DEFAULT_CLUB_PASSWORD   （選填）地區的各社預設密碼，與地區設定檔的 defaultClubPassword 相同
//   LINE_MESSAGING_ACCESS_TOKEN、LINE_PUSH_PASSWORD   （選填）LINE 推播用：官方帳號 Messaging API 的 Channel access token
//                           與推播密碼。兩個都有設定，這個地區才算「開放推播」；系統管理者要關閉時把它們刪掉即可。
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { AppError, handle, type Deps } from "./lib.ts";

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

const deps: Deps = {
  admin,
  push: {
    token: PUSH_TOKEN,
    password: (Deno.env.get("LINE_PUSH_PASSWORD") || "").trim(),
    // 一次最多 500 人；只有一人時用 push，多人用 multicast（計費方式相同：送達幾人算幾則）
    async send(userIds: string[], text: string) {
      const messages = [{ type: "text", text }];
      if (userIds.length === 1) await lineApi("/v2/bot/message/push", { method: "POST", body: JSON.stringify({ to: userIds[0], messages }) });
      else await lineApi("/v2/bot/message/multicast", { method: "POST", body: JSON.stringify({ to: userIds, messages }) });
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
  try {
    const body = await req.json().catch(() => ({}));
    return json(await handle(body, deps));
  } catch (e) {
    if (e instanceof AppError) return json({ ok: false, code: e.code });   // 不把內部訊息回傳給前端
    console.error("line-checkin 發生錯誤", e);
    return json({ ok: false, code: "SERVER_ERROR" });
  }
});
