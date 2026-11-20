// 各社活動提醒推播：逐社開放、前一天指定整點、只提醒已參加的人、與主委推播同一天不重複。假資料庫、假的 LINE 發送。
// 執行：deno run --no-check --node-modules-dir=none -A supabase/tests/club_reminder.ts
import { clubReminder, handleAdmin, pushRef } from "../functions/line-checkin/calendar.ts";
import { handle } from "../functions/line-checkin/lib.ts";
const ok = (name: string, cond: boolean) => { console.log((cond ? "✅ " : "❌ ") + name); if (!cond) Deno.exitCode = 1; };
function fake(tables: Record<string, any[]>, pk: Record<string, string[]> = {}) {
  return { from(t: string) {
    tables[t] ||= []; const f: any[] = []; let one = "", op = "select", payload: any = null, opt: any = null;
    const b: any = {
      select() { return b; }, eq(k: string, v: any) { f.push((r: any) => r[k] === v); return b; }, neq(k: string, v: any) { f.push((r: any) => r[k] !== v); return b; },
      in(k: string, v: any[]) { f.push((r: any) => v.includes(r[k])); return b; },
      gte(k: string, v: any) { f.push((r: any) => r[k] >= v); return b; }, lte(k: string, v: any) { f.push((r: any) => r[k] <= v); return b; },
      order() { return b; }, limit() { return b; }, range() { return b; }, maybeSingle() { one = "maybe"; return b; },
      insert(p: any) { op = "insert"; payload = p; return b; }, upsert(p: any, o: any) { op = "upsert"; payload = p; opt = o; return b; }, delete() { op = "delete"; return b; },
      then(res: any) {
        if (op === "delete") { tables[t] = tables[t].filter((r: any) => !f.every((x) => x(r))); return res({ data: null, error: null }); }
        if (op === "insert" || op === "upsert") {
          const keys = (opt && opt.onConflict ? opt.onConflict.split(",") : pk[t]) || [];
          for (const row of Array.isArray(payload) ? payload : [payload]) {
            const i = keys.length ? tables[t].findIndex((r: any) => keys.every((k: string) => r[k] === row[k])) : -1;
            if (i < 0) tables[t].push({ ...row }); else if (!(opt && opt.ignoreDuplicates)) tables[t][i] = { ...tables[t][i], ...row };
          }
          return res({ data: null, error: null });
        }
        const d = tables[t].filter((r: any) => f.every((x) => x(r))); res({ data: one ? d[0] || null : d, error: null });
      },
    }; return b; } };
}
const NOW = Date.parse("2026-11-19T20:00:30+08:00");     // 11/19 晚上 8 點，明天＝11/20
const ev = (o: any) => ({ status: "confirmed", all_day: false, location: "", address: "", dress_code: "", club_name: "", owner_key: "", registration_key: null, ...o });
const mk = () => ({
  calendar_club_push: [{ club_name: "松山社", enabled: true, hour: 20 }, { club_name: "北區社", enabled: true, hour: 18 }],
  calendar_events: [
    ev({ id: "golf", layer: "district", title: "高爾夫", registration_key: "sports::高爾夫", start_at: "2026-11-20T00:00:00.000Z", end_at: "2026-11-20T08:00:00.000Z", location: "林口" }),
    ev({ id: "meet", layer: "club", club_name: "松山社", title: "松山例會", start_at: "2026-11-20T10:00:00.000Z", end_at: "2026-11-20T12:00:00.000Z" }),
    ev({ id: "other", layer: "club", club_name: "北區社", title: "北區例會", start_at: "2026-11-20T10:00:00.000Z", end_at: "2026-11-20T12:00:00.000Z" }),
    ev({ id: "priv", layer: "private", club_name: "松山社", owner_key: "甲|A", title: "私人行程", start_at: "2026-11-20T03:00:00.000Z", end_at: "2026-11-20T04:00:00.000Z" }),
    ev({ id: "cancel", layer: "club", club_name: "松山社", title: "已取消", status: "cancelled", start_at: "2026-11-20T03:00:00.000Z", end_at: "2026-11-20T04:00:00.000Z" }),
    ev({ id: "multi", layer: "district", title: "昨天開始的多天活動", start_at: "2026-11-19T00:00:00.000Z", end_at: "2026-11-21T08:00:00.000Z" }),
    ev({ id: "later", layer: "club", club_name: "松山社", title: "後天的活動", start_at: "2026-11-21T10:00:00.000Z", end_at: "2026-11-21T12:00:00.000Z" }),
  ],
  calendar_rsvp: [
    { event_id: "meet", club_name: "松山社", person_key: "甲|A", full_name: "甲", nickname: "A" },
    { event_id: "meet", club_name: "松山社", person_key: "乙|B", full_name: "乙", nickname: "B" },
    { event_id: "meet", club_name: "松山社", person_key: "guest:乙|B:1", full_name: "乙的朋友", nickname: "" },
    { event_id: "meet", club_name: "松山社", person_key: "總監|DG", full_name: "總監", nickname: "DG" },
    { event_id: "multi", club_name: "松山社", person_key: "甲|A", full_name: "甲", nickname: "A" },
    { event_id: "cancel", club_name: "松山社", person_key: "甲|A", full_name: "甲", nickname: "A" },
    { event_id: "later", club_name: "松山社", person_key: "甲|A", full_name: "甲", nickname: "A" },
    { event_id: "other", club_name: "北區社", person_key: "丁|D", full_name: "丁", nickname: "D" },
    { event_id: "golf", club_name: "北區社", person_key: "丁|D", full_name: "丁", nickname: "D" },
  ],
  line_bindings: [
    { line_user_id: "U甲", club_name: "松山社", person_key: "甲|A", full_name: "甲" },
    { line_user_id: "U丙", club_name: "松山社", person_key: "丙|C", full_name: "丙" },
    { line_user_id: "U總", club_name: "松山社", person_key: "總監|DG", full_name: "總監" },
    { line_user_id: "U丁", club_name: "北區社", person_key: "丁|D", full_name: "丁" },
  ],
  calendar_roles: [{ club_name: "松山社", person_key: "總監|DG", role: "governor" }],
  calendar_push_sent: [] as any[],
} as Record<string, any[]>);
// 高爾夫的正式報名名單：松山社 甲、丙
const reg = { roster: async (k: string) => k === "sports::高爾夫" ? { ok: true, title: "高爾夫", persons: [{ club: "松山社", key: "甲|A", name: "甲", nickname: "A" }, { club: "松山社", key: "丙|C", name: "丙", nickname: "C" }, { club: "別社", key: "戊|E", name: "戊", nickname: "E" }] } : { ok: false, title: "", persons: [] } };
const J = (x: any) => JSON.stringify(x);
const run = async (T: any, o: any = {}) => { const sent: any[] = []; const r = await clubReminder(fake(T), { liffId: "LIFF-1", reg, now: NOW, send: async (to: string, m: any[]) => { sent.push({ to, m }); }, ...o }); return { r, sent }; };

let T = mk();
let { r, sent } = await run(T);
const st = (rr: any, name: string) => (rr.clubs[0].recipients.find((x: any) => x.name === name) || {}).status;
ok("排程在晚上 8 點：只處理設定 20 點的松山社，18 點的北區社不處理", r.clubs.length === 1 && r.clubs[0].club === "松山社" && r.day === "2026-11-20");
ok("只列明天開始的地區＋本社活動：不含私人、已取消、別社、昨天開始的多天活動、後天", r.clubs[0].events.map((e: any) => e.id).join() === "golf,meet");
ok("甲（例會按了參加＋高爾夫正式報名）收到一則，卡片有兩個活動", st(r, "甲") === "SENT" && sent.filter((s) => s.to === "U甲").length === 1 && J(sent.find((s) => s.to === "U甲")).includes("高爾夫") && J(sent.find((s) => s.to === "U甲")).includes("松山例會") && !J(sent.find((s) => s.to === "U甲")).includes("私人行程"));
ok("丙（只有正式報名高爾夫）收到一則，只有高爾夫", st(r, "丙") === "SENT" && J(sent.find((s) => s.to === "U丙")).includes("高爾夫") && !J(sent.find((s) => s.to === "U丙")).includes("松山例會"));
ok("乙沒綁定 LINE：不發、標 NOT_BOUND；非社友同行者不列", st(r, "乙") === "NOT_BOUND" && !r.clubs[0].recipients.some((x: any) => x.name === "乙的朋友"));
ok("總監已有每日推播：不重複提醒", st(r, "總監") === "GOV_DIGEST" && !sent.some((s) => s.to === "U總"));
ok("共發 2 則；卡片標題是「明天的活動提醒」、有社名與查看詳情連結", r.sent === 2 && sent.length === 2 && J(sent[0]).includes("明天的活動提醒") && J(sent[0]).includes("松山社") && J(sent[0]).includes("https://liff.line.me/LIFF-1?p=calendar&ev="));
ok("寫入發送紀錄：甲兩筆（報名活動用活動 key、例會用 cal:行程id）、丙一筆，來源 club", T.calendar_push_sent.length === 3 && T.calendar_push_sent.every((x: any) => x.source === "club" && x.sent_day === "2026-11-19") && T.calendar_push_sent.some((x: any) => x.person_key === "甲|A" && x.event_ref === "sports::高爾夫") && T.calendar_push_sent.some((x: any) => x.person_key === "甲|A" && x.event_ref === "cal:meet"));
({ r, sent } = await run(T));
ok("同一天再跑一次：不重發（ALREADY）", r.sent === 0 && sent.length === 0 && st(r, "甲") === "ALREADY" && st(r, "丙") === "ALREADY");
({ r, sent } = await run(T, { now: NOW + 86400_000 }));
ok("隔天再跑：是另一天，照常提醒（後天的活動變成明天）", r.day === "2026-11-21" && r.sent === 1 && J(sent[0]).includes("後天的活動"));

// 主委當天已經推過高爾夫
T = mk(); T.calendar_push_sent.push({ sent_day: "2026-11-19", event_ref: "sports::高爾夫", club_name: "松山社", person_key: "甲|A", source: "chair" }, { sent_day: "2026-11-19", event_ref: "sports::高爾夫", club_name: "松山社", person_key: "丙|C", source: "chair" });
({ r, sent } = await run(T));
ok("主委今天已推過高爾夫：甲只收到例會（不含高爾夫）、丙不再收到", r.sent === 1 && sent[0].to === "U甲" && J(sent[0]).includes("松山例會") && !J(sent[0]).includes("高爾夫") && st(r, "丙") === "ALREADY");
T = mk(); T.calendar_push_sent.push({ sent_day: "2026-11-18", event_ref: "sports::高爾夫", club_name: "松山社", person_key: "丙|C", source: "chair" });
({ r, sent } = await run(T));
ok("主委是昨天推的（不同天）：今天照常提醒", st(r, "丙") === "SENT" && r.sent === 2);

({ r, sent } = await run(mk(), { now: Date.parse("2026-11-19T18:00:10+08:00") }));
ok("晚上 6 點：只處理北區社（丁收到例會＋高爾夫的『我要參加』）", r.clubs.length === 1 && r.clubs[0].club === "北區社" && r.sent === 1 && sent[0].to === "U丁" && J(sent[0]).includes("北區例會") && J(sent[0]).includes("高爾夫"));
({ r, sent } = await run(mk(), { now: Date.parse("2026-11-19T15:00:10+08:00") }));
ok("沒有社設定這個整點：什麼都不做", r.clubs.length === 0 && sent.length === 0);
T = mk(); T.calendar_club_push = [];
({ r, sent } = await run(T));
ok("預設關閉：沒有開放任何社就不推", r.clubs.length === 0 && sent.length === 0);
T = mk();
const pv = await clubReminder(fake(T), { liffId: "LIFF-1", reg, now: Date.parse("2026-11-19T10:00:00+08:00"), club: "松山社" });
ok("預覽（指定社、不看時間）：列出誰會收到，不發送也不寫紀錄", pv.clubs[0].recipients.filter((x: any) => x.status === "PREVIEW").length === 2 && pv.sent === 0 && T.calendar_push_sent.length === 0);
ok("pushRef：有對應報名活動用活動 key，否則 cal:行程id", pushRef({ id: "x", registration_key: "a::b" }) === "a::b" && pushRef({ id: "x" }) === "cal:x");

// 後台動作
T = mk(); T.calendar_club_push = [];
const adminSent: any[] = [];
const ctx: any = { admin: fake(T), password: "pw", members: async () => ({}), clubInfos: async () => [{ name: "松山社", division: "第四分區", code: "04-2" }, { name: "北區社", division: "第一分區", code: "01-1" }], sendLine: async (to: string, m: any[]) => { adminSent.push({ to, m }); }, reg };
const A = async (action: string, o: any = {}) => { try { return await handleAdmin(action, { adminPassword: "pw", ...o }, ctx); } catch (e) { return { ok: false, code: (e as any).code }; } };
let a = await A("cal_admin_clubpush_get");
ok("後台：預設沒有任何社開放，回傳可選的時間（8～21 點）與預設 20 點", a.ok && a.clubs.length === 0 && a.defaultHour === 20 && a.hours[0] === 8 && a.hours[a.hours.length - 1] === 21);
a = await A("cal_admin_clubpush_save", { club: "松山社", enabled: true, hour: 19 });
ok("後台：開放松山社、前一天 19 點", a.ok && a.clubs.length === 1 && a.clubs[0].club === "松山社" && a.clubs[0].hour === 19);
a = await A("cal_admin_clubpush_save", { club: "松山社", enabled: true, hour: 20 });
ok("後台：改時間＝更新同一列，不會多一列", a.clubs.length === 1 && a.clubs[0].hour === 20 && T.calendar_club_push.length === 1);
ok("後台：不存在的社、不允許的時間（22 點、7 點、19.5）都擋下", (await A("cal_admin_clubpush_save", { club: "沒有這個社", enabled: true, hour: 20 })).code === "BAD_REQUEST" && (await A("cal_admin_clubpush_save", { club: "北區社", enabled: true, hour: 22 })).code === "BAD_REQUEST" && (await A("cal_admin_clubpush_save", { club: "北區社", enabled: true, hour: 7 })).code === "BAD_REQUEST" && (await A("cal_admin_clubpush_save", { club: "北區社", enabled: true, hour: 19.5 })).code === "BAD_REQUEST");
ok("後台：沒開放的社不能「現在發送」，但可以預覽", (await A("cal_admin_clubpush_send", { club: "北區社", liffId: "LIFF-1" })).code === "CAL_CLUB_PUSH_OFF" && (await A("cal_admin_clubpush_preview", { club: "北區社", liffId: "LIFF-1" })).ok === true && adminSent.length === 0);
ok("後台：密碼錯誤擋下", (await (async () => { try { return await handleAdmin("cal_admin_clubpush_get", { adminPassword: "x" }, ctx); } catch (e) { return { code: (e as any).code }; } })()).code === "CAL_ADMIN_AUTH_FAILED");
a = await A("cal_admin_clubpush_save", { club: "松山社", enabled: false });
ok("後台：關閉＝刪掉那一列", a.ok && a.clubs.length === 0 && T.calendar_club_push.length === 0);

// 排程入口：密碼把關
const T2 = mk(); T2.calendar_settings = [{ key: "cron_secret", value: "S3" }]; T2.app_storage = [];
const cronSent: any[] = [];
const deps: any = { admin: fake(T2), push: { token: "t", sendMessages: async (to: string, m: any[]) => { cronSent.push(to); } } };
const C = async (o: any) => { try { return await handle({ action: "cal_cron_club_remind", liffId: "LIFF-1", ...o }, deps); } catch (e) { return { ok: false, code: (e as any).code }; } };
ok("排程：密碼錯誤擋下、不發送", (await C({ secret: "bad" })).code === "CAL_CRON_AUTH_FAILED" && cronSent.length === 0);
const cr = await C({ secret: "S3" });
ok("排程：密碼正確可執行（實際發送與否依現在的整點）", cr.ok === true && typeof cr.sent === "number");
