// =====================================================================
// 雲端小程式：登入主委設定的信箱（IMAP），讀取上海商銀「入帳通知單」，
// 解析入帳日期／金額／存摺備註，寫入 bank_transactions 供前端對帳。
// 由 pg_cron 每 10 分鐘呼叫一次，前端「立即抓取」也會呼叫。
// 部署：supabase functions deploy fetch-bank-mail --no-verify-jwt
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { ImapFlow } from "npm:imapflow@1.0.171";
import { simpleParser } from "npm:mailparser@3.7.2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// 民國年 115/08/27 → 2026-08-27
function rocToIso(roc: string): string | null {
  const m = roc.match(/(\d{2,3})\/(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  const y = parseInt(m[1], 10) + 1911;
  return `${y}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

// 從通知信文字解析欄位
function parseNotice(text: string) {
  const clean = text.replace(/\r/g, "").replace(/[ \t　]+/g, " ");
  const acct = clean.match(/入帳帳號[:：]\s*([0-9*]+)/);
  const txTime = clean.match(/入帳交易日期[:：]\s*([0-9]{2,3}\/[0-9]{1,2}\/[0-9]{1,2}(?:\s+[0-9:]+)?)/);
  const bizDate = clean.match(/入帳營業日期[:：]\s*([0-9]{2,3}\/[0-9]{1,2}\/[0-9]{1,2})/);
  const amt = clean.match(/入帳金額[:：]\s*(?:TWD|NTD|NT\$)?\s*([0-9,]+(?:\.[0-9]+)?)/);
  const note = clean.match(/存摺備註[:：]\s*([^\n]*)/);
  if (!amt) return null; // 不是入帳通知
  const dateSrc = (txTime && txTime[1]) || (bizDate && bizDate[1]) || "";
  return {
    account_masked: acct ? acct[1] : null,
    tx_time: dateSrc || null,
    tx_date: dateSrc ? rocToIso(dateSrc) : null,
    amount: parseFloat(amt[1].replace(/,/g, "")),
    note: note ? note[1].trim() : "",
  };
}

function maskEmail(email: string) {
  const [u, d] = email.split("@");
  if (!d) return email;
  return `${u.slice(0, 2)}***@${d}`;
}

async function writeStatus(patch: Record<string, unknown>) {
  await admin.from("bank_mail_status").upsert({ id: 1, ...patch, updated_at: new Date().toISOString() });
}

let lastRunAt = 0; // 同一個執行個體內的簡單節流，避免被連點

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const now = Date.now();
  if (now - lastRunAt < 20_000) return json({ ok: true, skipped: true, reason: "20 秒內已抓取過" });
  lastRunAt = now;

  // 1. 讀信箱設定（只有 service role 讀得到）
  const { data: settings, error: sErr } = await admin.from("bank_mail_settings").select("*").eq("id", 1).maybeSingle();
  if (sErr) return json({ ok: false, error: `讀取設定失敗：${sErr.message}` }, 500);
  if (!settings || !settings.email || !settings.app_password) {
    await writeStatus({ has_password: false, email_masked: settings?.email ? maskEmail(settings.email) : null, last_error: "尚未設定入帳通知信箱或密碼" });
    return json({ ok: false, error: "尚未設定入帳通知信箱或密碼" }, 400);
  }

  const client = new ImapFlow({
    host: settings.imap_host || "imap.gmail.com",
    port: settings.imap_port || 993,
    secure: true,
    auth: { user: settings.email, pass: settings.app_password },
    logger: false,
  });

  let inserted = 0, scanned = 0, matchedMails = 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      // 只看最近 60 天的信
      const since = new Date(now - 60 * 24 * 3600 * 1000);
      const uids = await client.search({ since }, { uid: true });
      const filter = (settings.sender_filter || "scsb").toLowerCase();
      const uidValidity = String(client.mailbox && (client.mailbox as any).uidValidity || "0");

      // 已經匯入過的信就跳過
      const { data: existing } = await admin.from("bank_transactions").select("mail_uid");
      const seen = new Set((existing || []).map((r: any) => r.mail_uid));

      for (const uid of uids) {
        scanned++;
        const mailUid = `${uidValidity}-${uid}`;
        if (seen.has(mailUid)) continue;
        const msg = await client.fetchOne(String(uid), { envelope: true, source: true }, { uid: true });
        if (!msg || !msg.source) continue;
        const from = ((msg.envelope?.from || []).map((a: any) => `${a.name || ""} ${a.address || ""}`).join(" ")).toLowerCase();
        const subject = (msg.envelope?.subject || "").toLowerCase();
        const looksLikeBank = from.includes(filter) || subject.includes(filter) || subject.includes("入帳") || subject.includes("上海");
        if (!looksLikeBank) continue;

        const parsed = await simpleParser(msg.source);
        const text = (parsed.text || "") || (parsed.html ? String(parsed.html).replace(/<[^>]+>/g, "\n") : "");
        const fields = parseNotice(text);
        if (!fields) continue;
        matchedMails++;

        const { error: iErr } = await admin.from("bank_transactions").insert({
          mail_uid: mailUid,
          mail_date: parsed.date ? parsed.date.toISOString() : null,
          ...fields,
          raw_text: text.slice(0, 4000),
        });
        if (!iErr) inserted++;
      }
    } finally {
      lock.release();
    }
    await client.logout();

    const { count } = await admin.from("bank_transactions").select("id", { count: "exact", head: true });
    await writeStatus({
      email_masked: maskEmail(settings.email),
      has_password: true,
      last_fetch_at: new Date().toISOString(),
      last_result: `掃描 ${scanned} 封，其中銀行入帳通知 ${matchedMails} 封，新增 ${inserted} 筆`,
      last_error: null,
      total_transactions: count || 0,
    });
    return json({ ok: true, scanned, matchedMails, inserted });
  } catch (e) {
    const msg = (e && (e as Error).message) ? (e as Error).message : String(e);
    try { await client.logout(); } catch (_) { /* ignore */ }
    const friendly = /auth|login|credentials|invalid/i.test(msg)
      ? `信箱登入失敗，請確認 Email 與應用程式密碼是否正確（${msg}）`
      : msg;
    await writeStatus({ email_masked: maskEmail(settings.email), has_password: true, last_fetch_at: new Date().toISOString(), last_error: friendly });
    return json({ ok: false, error: friendly }, 500);
  }
});
