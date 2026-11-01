// =====================================================================
// 雲端小程式：登入主委設定的信箱（IMAP），讀取上海商銀「入帳通知單」，
// 取出加密 PDF 附件，用末六碼解密後解析入帳日期／金額／存摺備註，
// 寫入 bank_transactions 供前端對帳。核心邏輯在 lib.ts。
// 由 pg_cron 每 10 分鐘呼叫一次，前端「立即抓取」也會呼叫。
// 部署：supabase functions deploy fetch-bank-mail --no-verify-jwt
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { fetchBankNotices, maskEmail } from "./lib.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function writeStatus(patch: Record<string, unknown>) {
  await admin.from("bank_mail_status").upsert({ id: 1, ...patch, updated_at: new Date().toISOString() });
}

// 把技術錯誤訊息轉成主委看得懂的中文
function friendlyError(msg: string): string {
  if (/PDF 開啟密碼/.test(msg)) return msg;
  if (/登入被拒|auth|login|credentials|invalid|AUTHENTICATIONFAILED/i.test(msg)) return `信箱登入失敗（可能是帳密錯誤，或信箱服務商不允許從國外伺服器登入）：${msg}`;
  if (/ENOTFOUND|getaddrinfo|ECONNREFUSED|ETIMEDOUT|timeout/i.test(msg)) return `連不上收信主機，請確認「信箱服務」選對了（${msg}）`;
  return msg;
}

let lastRunAt = 0; // 同一個執行個體內的簡單節流，避免被連點

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const now = Date.now();
  if (now - lastRunAt < 5_000) return json({ ok: true, skipped: true, reason: "5 秒內已抓取過" });
  lastRunAt = now;

  // 1. 讀信箱設定（只有 service role 讀得到）
  const { data: settings, error: sErr } = await admin.from("bank_mail_settings").select("*").eq("id", 1).maybeSingle();
  if (sErr) return json({ ok: false, error: `讀取設定失敗：${sErr.message}` }, 500);
  if (!settings || !settings.email || !settings.app_password) {
    await writeStatus({ has_password: false, email_masked: settings?.email ? maskEmail(settings.email) : null, last_error: "尚未設定入帳通知信箱或密碼" });
    return json({ ok: false, error: "尚未設定入帳通知信箱或密碼" }, 400);
  }
  if (!settings.pdf_password) {
    await writeStatus({ has_password: true, email_masked: maskEmail(settings.email), last_fetch_at: new Date().toISOString(), last_error: "尚未填寫「PDF 開啟密碼」（戶名的身分證號或統一編號末六碼），無法讀取入帳通知單" });
    return json({ ok: false, error: "尚未填寫 PDF 開啟密碼" }, 400);
  }

  try {
    // 2. 已匯入過的信就跳過
    const { data: existing } = await admin.from("bank_transactions").select("mail_uid");
    const seen = new Set<string>((existing || []).map((r: any) => String(r.mail_uid)));

    // 3. 登入信箱抓取並解析（每解析出一筆就立刻寫入，避免超過 CPU 上限被中止時前功盡棄）
    await writeStatus({ email_masked: maskEmail(settings.email), has_password: true, last_result: "⏳ 處理中：正在登入信箱…" });
    let inserted = 0;
    const r = await fetchBankNotices({
      host: settings.imap_host || "imap.gmail.com",
      port: settings.imap_port || 993,
      user: settings.email,
      pass: settings.app_password,
      pdfPassword: String(settings.pdf_password),
      senderFilter: settings.sender_filter || "scsb",
      sinceDays: 60,
      seen,
      maxNew: 4,
      onNotice: async (n) => {
        const { error: iErr } = await admin.from("bank_transactions").insert(n);
        if (!iErr) inserted++;
      },
    });

    const { count } = await admin.from("bank_transactions").select("id", { count: "exact", head: true });
    const pdfNote = r.pdfErrors ? `；有 ${r.pdfErrors} 封 PDF 無法開啟（${r.lastPdfError}）` : "";
    const pendingNote = r.pending > 0 ? `；尚有 ${r.pending} 封待處理（系統每 10 分鐘自動續抓，或再按一次「立即抓取」）` : "";
    await writeStatus({
      email_masked: maskEmail(settings.email),
      has_password: true,
      last_fetch_at: new Date().toISOString(),
      last_result: `掃描 ${r.scanned} 封，其中銀行通知 ${r.bankMails} 封，新增入帳 ${inserted} 筆${pdfNote}${pendingNote}`,
      last_error: r.pdfErrors && inserted === 0 && r.notices.length === 0 ? friendlyError(r.lastPdfError || "PDF 讀取失敗") : null,
      total_transactions: count || 0,
    });
    return json({ ok: true, scanned: r.scanned, bankMails: r.bankMails, inserted, pdfErrors: r.pdfErrors, pending: r.pending });
  } catch (e) {
    const msg = (e && (e as Error).message) ? (e as Error).message : String(e);
    const friendly = friendlyError(msg);
    await writeStatus({ email_masked: maskEmail(settings.email), has_password: true, last_fetch_at: new Date().toISOString(), last_error: friendly });
    return json({ ok: false, error: friendly }, 500);
  }
});
