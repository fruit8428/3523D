// =====================================================================
// 抓信與解析的核心邏輯（index.ts 與本機測試腳本共用）
// 上海商銀的「入帳通知單」本文沒有金額，明細放在「加密 PDF 附件」裡，
// 開啟密碼是戶名的身分證號／統一編號末六碼，所以流程是：
//   IMAP 登入 → 找出銀行信 → 取出 PDF 附件 → 用末六碼解密 → 讀出文字 → 解析欄位
// =====================================================================
import { SimpleImap } from "./imap.ts";
import { Buffer } from "node:buffer";
import { simpleParser } from "npm:mailparser@3.7.2";
import { extractText, getDocumentProxy } from "npm:unpdf@0.12.1";

export interface NoticeFields {
  account_masked: string | null;
  tx_time: string | null;
  tx_date: string | null;
  amount: number;
  note: string;
}

export interface FetchedNotice extends NoticeFields {
  mail_uid: string;
  mail_date: string | null;
  raw_text: string;
}

export interface FetchOptions {
  host: string;
  port: number;
  user: string;
  pass: string;
  pdfPassword: string;      // PDF 開啟密碼（末六碼）
  senderFilter: string;     // 寄件者或主旨含此字樣才視為銀行信（預設 scsb）
  sinceDays: number;        // 只看最近幾天
  seen: Set<string>;        // 已匯入過的 mail_uid，跳過
  maxNew?: number;          // 每次最多處理幾封新信（Supabase 每次請求 CPU 只有 2 秒，一封 PDF 約 0.2 秒）
  onNotice?: (n: FetchedNotice) => Promise<void>; // 每解析出一筆就立刻回呼（馬上寫入資料庫，被中止也不會白做）
  onProgress?: (stage: string) => Promise<void>;  // 每個階段回呼一次（寫到狀態表，卡住時看得出卡在哪）
  log?: (msg: string) => void;
}

export interface FetchResult {
  scanned: number;          // 最近 N 天內掃過的信
  bankMails: number;        // 看起來是銀行信的數量
  notices: FetchedNotice[]; // 成功解析出的新入帳
  pdfErrors: number;        // PDF 解密／讀取失敗的封數
  lastPdfError: string | null;
  pending: number;          // 這次沒處理到、留給下次的新信數
}

// 民國年 115/08/27 → 2026-08-27
export function rocToIso(roc: string): string | null {
  const m = roc.match(/(\d{2,3})\/(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  const y = parseInt(m[1], 10) + 1911;
  return `${y}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

// PDF 轉文字時，有些字型會把「日、金、一」等字輸出成康熙部首字元（⽇⾦⼀），先換回一般中文
const RADICAL_FIX: Record<string, string> = { "⽇": "日", "⾦": "金", "⼀": "一", "⽉": "月", "⼊": "入", "⼈": "人", "⽂": "文", "⼤": "大", "⼩": "小", "⼿": "手" };
export function normalizeText(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[⽇⾦⼀⽉⼊⼈⽂⼤⼩⼿]/g, (c) => RADICAL_FIX[c] || c)
    .replace(/[ \t　]+/g, " ");
}

// 從通知單文字解析欄位；沒有「入帳金額」就不是入帳通知，回傳 null
export function parseNotice(text: string): NoticeFields | null {
  const clean = normalizeText(text);
  const acct = clean.match(/入\s*帳\s*帳\s*號\s*[:：]\s*([0-9*]+)/);
  const txTime = clean.match(/入\s*帳\s*交\s*易\s*日\s*期\s*[:：]\s*([0-9]{2,3}\/[0-9]{1,2}\/[0-9]{1,2}(?:\s+[0-9:]+)?)/);
  const bizDate = clean.match(/入\s*帳\s*營\s*業\s*日\s*期\s*[:：]\s*([0-9]{2,3}\/[0-9]{1,2}\/[0-9]{1,2})/);
  const amt = clean.match(/入\s*帳\s*金\s*額\s*[:：]\s*(?:TWD|NTD|NT\$)?\s*([0-9,]+(?:\.[0-9]+)?)/);
  // 備註只取到換行、或「入帳通知單注意事項」等後續段落之前（PDF 轉文字常把整頁串成一行）
  const noteRaw = clean.match(/存\s*摺\s*備\s*註\s*[:：]\s*(.*?)(?=\n|\s*入\s*帳\s*通\s*知\s*單|\s*注\s*意\s*事\s*項|\s*※|\s*Powered by|$)/s);
  if (!amt) return null;
  const dateSrc = (txTime && txTime[1]) || (bizDate && bizDate[1]) || "";
  return {
    account_masked: acct ? acct[1] : null,
    tx_time: dateSrc || null,
    tx_date: dateSrc ? rocToIso(dateSrc) : null,
    amount: parseFloat(amt[1].replace(/,/g, "")),
    note: noteRaw ? noteRaw[1].trim().slice(0, 100) : "",
  };
}

export function maskEmail(email: string) {
  const [u, d] = email.split("@");
  if (!d) return email;
  return `${u.slice(0, 2)}***@${d}`;
}

// 用密碼解開 PDF 並讀出全部文字。密碼若超過 6 碼且失敗，再用末六碼試一次（銀行規定是末六碼）
export async function extractPdfText(bytes: Uint8Array, password: string): Promise<string> {
  const candidates = [password];
  const digits = password.replace(/\D/g, "");
  if (digits.length > 6) candidates.push(digits.slice(-6));
  let lastErr: unknown = null;
  for (const pw of candidates) {
    try {
      const pdf = await getDocumentProxy(bytes, { password: pw });
      const { text } = await extractText(pdf, { mergePages: true });
      return String(text || "");
    } catch (e) {
      lastErr = e;
      const name = (e as any)?.name || "";
      if (!/Password|DataClone/i.test(name)) throw e; // 不是密碼問題就直接丟出
    }
  }
  throw new Error("PDF 開啟密碼錯誤（請填戶名的身分證號或統一編號末六碼）");
}

// 是否為銀行「入帳通知」：寄件者或主旨像銀行（含 sender_filter 或「上海」），且主旨含「入帳」
// 銀行的登入通知、廣告信主旨沒有「入帳」，直接略過，才不會每次都佔掉處理名額
export function looksLikeBankMail(from: string, subject: string, filter: string): boolean {
  const f = from.toLowerCase(), s = subject.toLowerCase(), k = (filter || "scsb").toLowerCase();
  const fromBank = f.includes(k) || s.includes(k) || s.includes("上海");
  return fromBank && s.includes("入帳");
}

export async function fetchBankNotices(opt: FetchOptions): Promise<FetchResult> {
  const log = opt.log || (() => {});
  const result: FetchResult = { scanned: 0, bankMails: 0, notices: [], pdfErrors: 0, lastPdfError: null, pending: 0 };
  const maxNew = Math.max(1, opt.maxNew || 4);
  const progress = async (stage: string) => { log(stage); if (opt.onProgress) { try { await opt.onProgress(stage); } catch (_) { /* ignore */ } } };
  const imap = new SimpleImap(opt.host, opt.port, (m) => log(m));
  const describe = (e: any) => {
    const parts = [e?.message || String(e)];
    if (e?.responseText) parts.push(`伺服器回應：${e.responseText}`);
    if (e?.authenticationFailed) parts.push("（登入被拒）");
    if (imap.trail.length) parts.push(`紀錄：${imap.trail.slice(-6).join(" / ")}`);
    return parts.join("；");
  };

  await progress("①連線並登入信箱");
  try {
    await imap.connect();
    await imap.login(opt.user, opt.pass);
  } catch (e) {
    const err = new Error(describe(e));
    (err as any).authenticationFailed = !!(e as any)?.authenticationFailed;
    throw err;
  }
  try {
    await progress("②登入成功，開啟收件匣");
    const uidValidity = await imap.examine("INBOX");
    await progress("③搜尋最近 " + opt.sinceDays + " 天的信");
    // SEARCH SINCE 只有日期（純 ASCII），HiNet / Gmail 都支援；中文關鍵字改在程式內過濾
    const since = new Date(Date.now() - opt.sinceDays * 24 * 3600 * 1000);
    const uids = await imap.uidSearchSince(since);
    result.scanned = uids.length;
    if (uids.length === 0) return result;

    // 第一輪：只抓信頭（寄件者／主旨／Message-ID），挑出銀行入帳通知；每 25 封一批
    const candidates: { uid: number; size: number; key: string }[] = [];
    for (let i = 0; i < uids.length; i += 25) {
      const chunk = uids.slice(i, i + 25);
      await progress(`④掃描信頭 ${Math.min(i + 25, uids.length)}/${uids.length}`);
      const heads = await imap.fetchHeaders(chunk);
      for (const h of heads) {
        const parsed = await simpleParser(h.headers + "\r\n\r\n");
        const from = (parsed.from?.text || "");
        const subject = parsed.subject || "";
        if (!looksLikeBankMail(from, subject, opt.senderFilter)) continue;
        result.bankMails++;
        // 去重用 Message-ID（HiNet 的 UID 不保證固定）；沒有 Message-ID 才退回 uidValidity-uid
        const key = (parsed.messageId && String(parsed.messageId).trim()) || `${uidValidity}-${h.uid}`;
        if (opt.seen.has(key)) continue;
        candidates.push({ uid: h.uid, size: h.size, key });
      }
    }
    await progress(`⑤銀行入帳通知 ${result.bankMails} 封，其中 ${candidates.length} 封尚未匯入`);

    // 第二輪：只對新的信分段下載完整內容；最多「解 maxNew 個 PDF」，其餘留給下次
    let heavy = 0, index = 0;
    for (; index < candidates.length; index++) {
      if (heavy >= maxNew) break;
      const c = candidates[index];
      await progress(`⑥下載並解析第 ${index + 1}/${candidates.length} 封`);
      const source = await imap.fetchSource(c.uid, c.size);
      if (source.length === 0) continue;
      const parsed = await simpleParser(Buffer.from(source)); // mailparser 要 Node Buffer
      let text = "";
      // 先找 PDF 附件（銀行把 PDF 標成 text/plain，所以用檔名或檔頭判斷）
      const pdfAtt = (parsed.attachments || []).find((a: any) => {
        const name = String(a.filename || "").toLowerCase();
        const head = a.content ? String.fromCharCode(...a.content.slice(0, 4)) : "";
        return name.endsWith(".pdf") || head === "%PDF";
      });
      if (pdfAtt) {
        heavy++; // 解 PDF 才算吃重的工作（約 0.2 秒 CPU）
        try {
          text = await extractPdfText(new Uint8Array(pdfAtt.content), opt.pdfPassword);
        } catch (e) {
          result.pdfErrors++;
          result.lastPdfError = (e as Error)?.message || String(e);
          log(`PDF 讀取失敗（${c.key}）：${result.lastPdfError}`);
          continue;
        }
      } else {
        // 沒有附件就看信件本文（相容舊格式）
        text = (parsed.text || "") || (parsed.html ? String(parsed.html).replace(/<[^>]+>/g, "\n") : "");
      }
      const fields = parseNotice(text);
      if (!fields) { log(`不是入帳通知，跳過（${c.key}）`); continue; }
      if (!pdfAtt) heavy++;
      const notice: FetchedNotice = {
        mail_uid: c.key,
        mail_date: parsed.date ? parsed.date.toISOString() : null,
        ...fields,
        raw_text: normalizeText(text).slice(0, 4000),
      };
      result.notices.push(notice);
      if (opt.onNotice) await opt.onNotice(notice);
    }
    result.pending = Math.max(0, candidates.length - index);
  } catch (e) {
    throw new Error(describe(e));
  } finally {
    await imap.logout();
  }
  return result;
}
