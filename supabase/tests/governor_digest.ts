// 總監每日推播（calendar.ts 的 governorDigest，以及 lib.ts 的 cal_cron_digest／cal_admin_digest_*）。假資料庫、假的 LINE 發送。
// 執行：deno run --no-check --node-modules-dir=none -A supabase/tests/governor_digest.ts
import { governorDigest, buildDigestMessage, digestTimeText } from "../functions/line-checkin/calendar.ts";
import { handle } from "../functions/line-checkin/lib.ts";
const ok = (name: string, cond: boolean) => { console.log((cond ? "✅ " : "❌ ") + name); if (!cond) Deno.exitCode = 1; };
function fake(tables: Record<string, any[]>) {
  return { from(t: string) {
    tables[t] ||= []; const f: any[] = []; let op = "select", payload: any = null, one = "";
    const run = () => {
      const m = (r: any) => f.every((x) => x(r));
      if (op === "insert") { (Array.isArray(payload) ? payload : [payload]).forEach((p: any) => tables[t].push({ ...p })); return []; }
      return tables[t].filter(m);
    };
    const b: any = {
      select() { return b; }, insert(p: any) { op = "insert"; payload = p; return b; },
      eq(k: string, v: any) { f.push((r: any) => r[k] === v); return b; }, neq(k: string, v: any) { f.push((r: any) => r[k] !== v); return b; },
      in(k: string, vs: any[]) { f.push((r: any) => vs.includes(r[k])); return b; },
      gte(k: string, v: any) { f.push((r: any) => r[k] >= v); return b; }, lte(k: string, v: any) { f.push((r: any) => r[k] <= v); return b; },
      order() { return b; }, limit() { return b; }, maybeSingle() { one = "maybe"; return b; },
      then(res: any) { const d = run(); res({ data: one ? d[0] || null : d, error: null }); },
    }; return b; } };
}
const NOW = Date.parse("2026-12-04T20:00:00+08:00");     // 12/4 晚上 8 點 → 推 12/5 的行程
const ev = (o: any) => ({ id: "e" + Math.random().toString(36).slice(2, 7), status: "confirmed", all_day: false, location: "", address: "", dress_code: "", club_name: "", owner_key: "", ...o });
const T: Record<string, any[]> = {
  calendar_roles: [
    { club_name: "松山社", person_key: "王|Gov", full_name: "王總監", nickname: "Gov", role: "governor" },
    { club_name: "北區社", person_key: "林|Amy", full_name: "林秘書", nickname: "Amy", role: "governor_cc" },
    { club_name: "松山社", person_key: "陳|", full_name: "陳", nickname: "", role: "club_editor" },
  ],
  line_bindings: [{ club_name: "松山社", person_key: "王|Gov", line_user_id: "U-gov" }, { club_name: "北區社", person_key: "林|Amy", line_user_id: "U-amy" }],
  calendar_events: [
    ev({ id: "d1", layer: "district", title: "地區授證典禮", start_at: "2026-12-05T10:00:00.000Z", end_at: "2026-12-05T13:00:00.000Z", location: "君悅飯店", dress_code: "正式服裝" }),
    ev({ id: "c1", layer: "club", club_name: "松山社", title: "松山社例會", start_at: "2026-12-05T11:00:00.000Z", end_at: "2026-12-05T13:00:00.000Z" }),
    ev({ id: "p1", layer: "private", club_name: "松山社", owner_key: "王|Gov", title: "總監私人行程", start_at: "2026-12-05T01:00:00.000Z", end_at: "2026-12-05T02:00:00.000Z" }),
    ev({ id: "a1", layer: "district", title: "地區全天研習", all_day: true, start_at: "2026-12-04T16:00:00.000Z", end_at: "2026-12-05T15:59:00.000Z" }),
    ev({ id: "x1", layer: "club", club_name: "北區社", title: "別社的例會", start_at: "2026-12-05T11:00:00.000Z", end_at: "2026-12-05T13:00:00.000Z" }),
    ev({ id: "x2", layer: "private", club_name: "松山社", owner_key: "陳|", title: "別人的私人行程", start_at: "2026-12-05T11:00:00.000Z", end_at: "2026-12-05T12:00:00.000Z" }),
    ev({ id: "x3", layer: "district", title: "已取消的活動", status: "cancelled", start_at: "2026-12-05T11:00:00.000Z", end_at: "2026-12-05T12:00:00.000Z" }),
    ev({ id: "n1", layer: "district", title: "總監沒表示參加的地區活動", start_at: "2026-12-05T05:00:00.000Z", end_at: "2026-12-05T06:00:00.000Z" }),
    ev({ id: "x4", layer: "district", title: "後天的活動", start_at: "2026-12-06T11:00:00.000Z", end_at: "2026-12-06T12:00:00.000Z" }),
  ],
  calendar_digest_log: [],
  // 總監按了「我要參加」的活動（d1、c1、a1）；n1 沒按、r1 是執秘幫他正式報名的
  calendar_rsvp: [{ event_id: "d1", club_name: "松山社", person_key: "王|Gov" }, { event_id: "c1", club_name: "松山社", person_key: "王|Gov" }, { event_id: "a1", club_name: "松山社", person_key: "王|Gov" }, { event_id: "n1", club_name: "松山社", person_key: "陳|" }],
  calendar_settings: [{ key: "cron_secret", value: "s3cret" }],
};
const db = fake(T);
const sent: { to: string; messages: any[] }[] = [];
const send = async (to: string, messages: any[]) => { sent.push({ to, messages }); };

const pv = await governorDigest(db, { liffId: "123-abc", now: NOW });
const g = pv.governors[0];
ok("預設推「明天」（12/5）；不發送時只預覽", pv.day === "2026-12-05" && sent.length === 0 && g.recipients.every((r: any) => r.status === "PREVIEW"));
ok("內容＝總監私人＋總監已參加的地區／社內活動；別社、別人的私人、已取消、後天的都不列", g.events.map((e: any) => e.id).sort().join() === "a1,c1,d1,p1");
ok("總監沒按「我要參加」的地區活動不推（別人按的不算）", !g.events.some((e: any) => e.id === "n1"));
{
  const T2 = { ...T, calendar_events: [...T.calendar_events, ev({ id: "r1", layer: "district", registration_key: "k::高球", title: "執秘已幫總監報名的活動", start_at: "2026-12-05T07:00:00.000Z", end_at: "2026-12-05T08:00:00.000Z" }), ev({ id: "r2", layer: "district", registration_key: "k::別的", title: "有報名活動但總監沒報", start_at: "2026-12-05T07:00:00.000Z", end_at: "2026-12-05T08:00:00.000Z" })] };
  const reg = { roster: async (k: string) => ({ ok: true, title: k, persons: k === "k::高球" ? [{ club: "松山社", key: "王|Gov", name: "王總監" }] : [{ club: "松山社", key: "陳|", name: "陳" }] }) };
  const ids = (await governorDigest(fake(T2), { liffId: "123-abc", now: NOW, reg })).governors[0].events.map((e: any) => e.id);
  ok("執秘已幫總監正式報名的活動會推；有報名活動但總監不在名單的不推", ids.includes("r1") && !ids.includes("r2"));
}
ok("排序：全天在最前面，其餘依開始時間", g.events.map((e: any) => e.id).join() === "a1,p1,d1,c1");
ok("收件人：總監＋總監秘書（副本）", g.recipients.map((r: any) => r.as + r.name).join() === "總監王總監,總監秘書（副本）林秘書");
ok("時間文字：18:00–21:00、全天", g.events.find((e: any) => e.id === "d1").time === "18:00–21:00" && g.events.find((e: any) => e.id === "a1").time === "全天");

const r1 = await governorDigest(db, { liffId: "123-abc", now: NOW, send });
ok("正式推播：總監、秘書各一則，寫入發送紀錄", r1.sent === 2 && sent.map((x) => x.to).join() === "U-gov,U-amy" && T.calendar_digest_log.length === 2);
const card = sent[0].messages[0];
ok("卡片：Flex、標題寫明天與總監、每筆有「查看詳情」連到 LIFF 的那筆行程", card.type === "flex" && card.altText.includes("明天 12/5（六）有 4 個行程") && card.contents.header.contents[1].text.includes("總監 王總監 Gov") && JSON.stringify(card).includes("https://liff.line.me/123-abc?p=calendar&ev=d1&d=2026-12-05"));
ok("卡片：列出地點與服裝", JSON.stringify(card).includes("📍 君悅飯店") && JSON.stringify(card).includes("👔 正式服裝"));
ok("秘書收到的是同一份（含總監的私人行程）", JSON.stringify(sent[1].messages[0]) === JSON.stringify(card) && JSON.stringify(card).includes("總監私人行程"));
sent.length = 0;
const r2 = await governorDigest(db, { liffId: "123-abc", now: NOW, send });
ok("同一天再觸發一次：不會重發（ALREADY）", r2.sent === 0 && sent.length === 0 && r2.governors[0].recipients.every((r: any) => r.status === "ALREADY"));
const r3 = await governorDigest(db, { liffId: "123-abc", now: NOW, send, test: true });
ok("測試發送：不受限制、卡片標【測試】、不寫紀錄", r3.sent === 2 && sent[0].messages[0].altText.startsWith("【測試】") && T.calendar_digest_log.length === 2);
sent.length = 0;
const r4 = await governorDigest(db, { liffId: "123-abc", now: NOW, send, day: "2026-12-07" });
ok("那天沒有行程：不推播（NO_EVENTS）", r4.sent === 0 && sent.length === 0 && r4.governors[0].recipients.every((r: any) => r.status === "NO_EVENTS"));
T.line_bindings.pop();
T.calendar_digest_log.length = 0;
const r5 = await governorDigest(db, { liffId: "123-abc", now: NOW, send });
ok("秘書沒綁定 LINE：只推總監，秘書標 NOT_BOUND", r5.sent === 1 && r5.governors[0].recipients[1].status === "NOT_BOUND");
const r6 = await governorDigest(fake({ calendar_roles: [] }), { liffId: "123-abc", now: NOW, send });
ok("沒有指定總監：不推播", r6.governors.length === 0 && r6.note === "NO_GOVERNOR");
const many = Array.from({ length: 12 }, (_, i) => ev({ layer: "district", title: "活動" + i, start_at: "2026-12-05T01:00:00.000Z", end_at: "2026-12-05T02:00:00.000Z" }));
ok("超過 10 個行程：卡片列 10 個並寫「還有 2 個」", JSON.stringify(buildDigestMessage({ name: "王" }, "2026-12-05", many, "x")).includes("還有 2 個行程"));
ok("跨天活動的時間文字", digestTimeText({ all_day: false, start_at: "2026-12-04T10:00:00.000Z", end_at: "2026-12-05T04:00:00.000Z" }, "2026-12-05") === "（前一天開始） ～ 12:00");

// lib.ts：排程入口與後台入口
T.calendar_digest_log.length = 0; sent.length = 0;
T.line_bindings.push({ club_name: "北區社", person_key: "林|Amy", line_user_id: "U-amy" });
const deps: any = { admin: db, verify: async () => { throw new Error("不該驗證 LINE"); }, broadcast: async () => {}, defaultClubPassword: "", calendarAdminPassword: "pw",
  push: { token: "tok", password: "", send: async () => {}, quota: async () => null, broadcast: async () => {}, friends: async () => null, sendMessages: send } };
const code = async (p: Promise<any>) => { try { const r = await p; return r.ok === false ? r.code : "OK"; } catch (e: any) { return e.code || String(e); } };
ok("排程密碼錯誤被擋", await code(handle({ action: "cal_cron_digest", secret: "wrong", liffId: "123-abc" }, deps)) === "CAL_CRON_AUTH_FAILED");
ok("沒有官方帳號 token：PUSH_DISABLED", await code(handle({ action: "cal_cron_digest", secret: "s3cret", liffId: "123-abc" }, { ...deps, push: undefined })) === "PUSH_DISABLED");
const cr = await handle({ action: "cal_cron_digest", secret: "s3cret", liffId: "123-abc" }, deps);
ok("排程密碼正確：推播明天的行程（依當下時間）", cr.ok && typeof cr.day === "string" && Array.isArray(cr.governors));
ok("後台預覽要後台密碼", await code(handle({ action: "cal_admin_digest_preview", adminPassword: "x", liffId: "123-abc" }, deps)) === "CAL_ADMIN_AUTH_FAILED");
const ap = await handle({ action: "cal_admin_digest_preview", adminPassword: "pw", liffId: "123-abc", day: "2026-12-05" }, deps);
ok("後台預覽：列出行程與收件人，不發送", ap.ok && ap.governors[0].events.length === 4 && ap.governors[0].recipients.every((r: any) => r.status === "PREVIEW"));
sent.length = 0;
const at = await handle({ action: "cal_admin_digest_test", adminPassword: "pw", liffId: "123-abc", day: "2026-12-05" }, deps);
ok("後台測試發送：立刻發給總監與秘書、標【測試】", at.ok && at.sent === 2 && sent.every((x) => x.messages[0].altText.startsWith("【測試】")));
ok("後台可以指定「總監秘書」角色", (await code(handle({ action: "cal_admin_grant", adminPassword: "pw", club: "鬼社", personKey: "x|", role: "governor_cc" }, deps))) !== "BAD_REQUEST");
