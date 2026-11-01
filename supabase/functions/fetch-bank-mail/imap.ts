// =====================================================================
// 精簡版 IMAP 讀信程式（只做這個系統需要的五件事：登入、開收件匣、搜尋、抓信頭、分段下載信件）
// 用 Deno 原生 Deno.connectTls，不依賴 node 相容層；大信件用 64 KB 分段下載，
// 避免 imapflow 在 Supabase 雲端環境下載大資料時無聲掛住的問題（2026-11-01 實測）。
// =====================================================================
const enc = new TextEncoder();
const dec = new TextDecoder();
const CHUNK = 65536;

export interface ImapItem { text: string; literals: Uint8Array[] }
export interface ImapResponse { status: string; text: string; untagged: ImapItem[] }
export interface HeaderInfo { uid: number; size: number; headers: string }

function quote(s: string) { return '"' + s.replace(/([\\"])/g, "\\$1") + '"'; }
function indexOfCRLF(b: Uint8Array): number {
  for (let i = 0; i + 1 < b.length; i++) if (b[i] === 13 && b[i + 1] === 10) return i;
  return -1;
}
async function writeAll(conn: Deno.Conn, data: Uint8Array) {
  let off = 0;
  while (off < data.length) off += await conn.write(data.subarray(off));
}

export class SimpleImap {
  private conn!: Deno.TlsConn;
  private buf = new Uint8Array(0);
  private tagNo = 0;
  trail: string[] = []; // 最後幾行通訊紀錄（出錯時回報用，不含密碼）

  constructor(private host: string, private port: number, private log?: (s: string) => void) {}

  private note(s: string) {
    this.trail.push(s.slice(0, 160));
    if (this.trail.length > 12) this.trail.shift();
    if (this.log) this.log(s);
  }

  async connect() {
    this.conn = await Deno.connectTls({ hostname: this.host, port: this.port });
    const greeting = await this.readLine();
    this.note(`S: ${greeting}`);
    if (!/^\* (OK|PREAUTH)/.test(greeting)) throw new Error(`伺服器打招呼異常：${greeting}`);
  }

  private async fill(): Promise<boolean> {
    const chunk = new Uint8Array(CHUNK);
    const n = await this.conn.read(chunk);
    if (n === null) return false;
    const merged = new Uint8Array(this.buf.length + n);
    merged.set(this.buf);
    merged.set(chunk.subarray(0, n), this.buf.length);
    this.buf = merged;
    return true;
  }

  // 讀一行（不含 CRLF）
  private async readLine(): Promise<string> {
    while (true) {
      const idx = indexOfCRLF(this.buf);
      if (idx >= 0) {
        const line = dec.decode(this.buf.subarray(0, idx));
        this.buf = this.buf.slice(idx + 2);
        return line;
      }
      if (!(await this.fill())) throw new Error("連線被伺服器中斷");
    }
  }

  private async readBytes(n: number): Promise<Uint8Array> {
    while (this.buf.length < n) {
      if (!(await this.fill())) throw new Error("連線被伺服器中斷");
    }
    const out = this.buf.slice(0, n);
    this.buf = this.buf.slice(n);
    return out;
  }

  // 讀一個完整回應項目：行尾若是 {N} 代表接著有 N 位元組的原始資料（literal），讀完再繼續讀同一項目的剩餘文字
  private async readItem(): Promise<ImapItem> {
    let text = "";
    const literals: Uint8Array[] = [];
    while (true) {
      const line = await this.readLine();
      const m = line.match(/\{(\d+)\}$/);
      if (!m) return { text: text + line, literals };
      text += line.slice(0, -m[0].length) + `<<L${literals.length}>>`;
      literals.push(await this.readBytes(parseInt(m[1], 10)));
    }
  }

  async cmd(command: string, hideArgs = false): Promise<ImapResponse> {
    const tag = "A" + String(++this.tagNo).padStart(3, "0");
    this.note(`C: ${tag} ${hideArgs ? command.split(" ")[0] + " ****" : command.slice(0, 120)}`);
    await writeAll(this.conn, enc.encode(`${tag} ${command}\r\n`));
    const untagged: ImapItem[] = [];
    while (true) {
      const item = await this.readItem();
      if (item.text.startsWith(tag + " ")) {
        const rest = item.text.slice(tag.length + 1);
        const status = rest.split(" ")[0];
        this.note(`S: ${item.text.slice(0, 120)}`);
        if (status !== "OK") {
          const err: any = new Error(`指令 ${command.split(" ")[0]} 失敗：${rest}`); // 只印指令名稱，不印帳號等參數
          err.responseText = rest;
          err.command = command.split(" ")[0];
          err.authenticationFailed = /^LOGIN/i.test(command);
          throw err;
        }
        return { status, text: rest, untagged };
      }
      if (item.text.startsWith("+")) continue;
      untagged.push(item);
    }
  }

  async login(user: string, pass: string) {
    await this.cmd(`LOGIN ${quote(user)} ${quote(pass)}`, true);
  }

  // 唯讀方式開啟信箱（不會把信標成已讀），回傳 UIDVALIDITY
  async examine(mailbox = "INBOX"): Promise<string> {
    const r = await this.cmd(`EXAMINE ${quote(mailbox)}`);
    for (const u of r.untagged) {
      const m = u.text.match(/\[UIDVALIDITY (\d+)\]/);
      if (m) return m[1];
    }
    return "0";
  }

  async uidSearchSince(date: Date): Promise<number[]> {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const d = `${date.getUTCDate()}-${months[date.getUTCMonth()]}-${date.getUTCFullYear()}`;
    const r = await this.cmd(`UID SEARCH SINCE ${d}`);
    const uids: number[] = [];
    for (const u of r.untagged) {
      const m = u.text.match(/^\* SEARCH\s*(.*)$/);
      if (m && m[1].trim()) uids.push(...m[1].trim().split(/\s+/).map((x) => parseInt(x, 10)).filter((n) => !isNaN(n)));
    }
    return uids;
  }

  // 只抓需要的幾個信頭欄位與信件大小
  async fetchHeaders(uids: number[]): Promise<HeaderInfo[]> {
    if (uids.length === 0) return [];
    const r = await this.cmd(`UID FETCH ${uids.join(",")} (UID RFC822.SIZE BODY.PEEK[HEADER.FIELDS (FROM SUBJECT MESSAGE-ID DATE)])`);
    const out: HeaderInfo[] = [];
    for (const u of r.untagged) {
      const uidM = u.text.match(/UID (\d+)/);
      if (!uidM || !/FETCH/.test(u.text)) continue;
      const sizeM = u.text.match(/RFC822\.SIZE (\d+)/);
      out.push({ uid: parseInt(uidM[1], 10), size: sizeM ? parseInt(sizeM[1], 10) : 0, headers: u.literals[0] ? dec.decode(u.literals[0]) : "" });
    }
    return out;
  }

  // 讀某個 MIME 段落的標頭（很小），用來判斷它是不是 PDF 附件
  async fetchPartMime(uid: number, part: string): Promise<string> {
    const r = await this.cmd(`UID FETCH ${uid} (BODY.PEEK[${part}.MIME])`);
    const item = r.untagged.find((u) => /FETCH/.test(u.text) && u.literals.length > 0);
    return item ? dec.decode(item.literals[0]) : "";
  }

  // 分段下載整封信或某個段落（每段 64 KB），不改變已讀狀態；section 留空＝整封
  async fetchSource(uid: number, size: number, section = ""): Promise<Uint8Array> {
    const parts: Uint8Array[] = [];
    let off = 0, total = 0;
    while (true) {
      const r = await this.cmd(`UID FETCH ${uid} (BODY.PEEK[${section}]<${off}.${CHUNK}>)`);
      const item = r.untagged.find((u) => /FETCH/.test(u.text) && u.literals.length > 0);
      const chunk = item ? item.literals[0] : new Uint8Array(0);
      if (chunk.length === 0) break;
      parts.push(chunk);
      total += chunk.length;
      off += chunk.length;
      if (chunk.length < CHUNK || (size > 0 && off >= size)) break;
    }
    const all = new Uint8Array(total);
    let p = 0;
    for (const c of parts) { all.set(c, p); p += c.length; }
    return all;
  }

  async logout() {
    try { await this.cmd("LOGOUT"); } catch (_) { /* ignore */ }
    try { this.conn.close(); } catch (_) { /* ignore */ }
  }
}
