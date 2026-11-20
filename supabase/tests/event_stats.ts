// 報名／繳費統計：checkin-core.js 的算法 + 雲端權限（誰可以看）
import "../functions/line-checkin/checkin-core.js";
import { handleMember, handleAdmin } from "../functions/line-checkin/calendar.ts";
const Core = (globalThis as any).CheckinCore;
const ok = (name: string, cond: boolean) => { console.log((cond ? "✅ " : "❌ ") + name); if (!cond) Deno.exitCode = 1; };
const code = async (p: Promise<any>) => { try { await p; return "OK"; } catch (e: any) { return e.code || String(e); } };

const state = {
  categoriesData: [
    { id: "app", name: "地辦分攤金/配合款", subEvents: ["上半年分攤金"] },
    { id: "seminars", name: "研討會", subEvents: ["地區訓練講習會", "社長當選人研討會 PELS"] },
    { id: "sports", name: "運動賽事", allowSponsors: true, subEvents: ["高爾夫"] },
  ],
  divisionsData: [
    { id: 1, name: "第一分區", clubs: [{ name: "甲社" }, { name: "乙社" }] },
    { id: 2, name: "第二分區", clubs: [{ name: "丙社" }] },
    { id: 14, name: "地區團隊", clubs: [{ name: "地區辦公室" }] },
  ],
  registrationOrders: {
    "高爾夫": [
      { clubName: "甲社", grandTotal: 2400, items: [{ name: "王", nickname: "" }, { name: "趙", nickname: "Z" }] },
      { clubName: "丙社", grandTotal: 1200, items: [{ name: "林", nickname: "" }] },
    ],
    "地區訓練講習會": [{ clubName: "甲社", grandTotal: 0, items: [{ name: "王", nickname: "" }] }],
    "社長當選人研討會 PELS": [{ clubName: "乙社", grandTotal: 9000, items: [{ name: "李", nickname: "", pelsOption: "FAMILY" }, { name: "陳", nickname: "", pelsOption: "ABSENT" }] }],
  },
  chairConfig: { feeApportionment: 5000, subEventFees: { "app::上半年分攤金": { feeApportionment: 20000 } } },
};
const payments = {
  "app::上半年分攤金": { 甲社: { status: "PAID_EMAIL", amount: 20000 }, 乙社: { status: "NOTIFIED", amount: 20000 }, 丙社: { status: "EXEMPT" }, 地區辦公室: { status: "PAID_MANUAL", amount: 1 } },
  "sports::高爾夫": { 甲社: { status: "PAID_MANUAL", amount: 2400 } },
};
const a = Core.eventStats(state, payments, "app::上半年分攤金");
ok("分攤金：每社都要繳、排除地區辦公室；已繳含免繳，NOTIFIED 算未繳", a.ok && a.mode === "apportion" && a.dueClubs === 3 && a.paidClubs === 2 && a.paidAmt === 20000 && a.expected === 60000 && a.people === null);
ok("分攤金：各分區未繳社名", a.rows.length === 2 && a.rows[0].unpaid.join() === "乙社" && a.rows[0].paid.join() === "甲社" && a.rows[1].unpaid.length === 0 && a.rows[1].rate === 1);
const dr = Core.divisionPayRows(state.divisionsData, payments["app::上半年分攤金"]);
ok("與主委後台圖表同一份算法（divisionPayRows）", dr.tClubs === a.dueClubs && dr.tPaid === a.paidClubs && dr.tAmt === a.paidAmt);
const g = Core.eventStats(state, payments, "sports::高爾夫");
ok("運動賽事：有報名的社才要繳；人數與應收取自報名表", g.mode === "order" && g.regClubs === 2 && g.people === 3 && g.dueClubs === 2 && g.paidClubs === 1 && g.expected === 3600 && g.paidAmt === 2400 && g.allClubs === 3);
ok("運動賽事：未繳只列已報名的社", g.rows.find((r: any) => r.name === "第二分區").unpaid.join() === "丙社" && g.rows.find((r: any) => r.name === "第一分區").unpaid.length === 0);
const s = Core.eventStats(state, payments, "seminars::地區訓練講習會");
ok("研討會：每社固定金額（沒設定時用舊的全域值）", s.mode === "fixed" && s.fee === 5000 && s.dueClubs === 3 && s.expected === 15000 && s.people === 1 && s.regClubs === 1);
const p = Core.eventStats(state, payments, "seminars::社長當選人研討會 PELS");
ok("PELS：依報名表金額；不克參加不算、攜眷多算一位", p.mode === "order" && p.people === 2 && p.dueClubs === 1 && p.expected === 9000);
ok("不存在的活動", Core.eventStats(state, payments, "x::y").ok === false && Core.listStatEvents(state).length === 4);

// ---------- 權限 ----------
function fake(tables: Record<string, any[]>) {
  return { from(t: string) {
    tables[t] ||= []; const f: any[] = []; let op = "select", payload: any = null, one = false;
    const b: any = {
      select() { return b; }, insert(pl: any) { op = "insert"; payload = pl; return b; }, delete() { op = "delete"; return b; },
      eq(k: string, v: any) { f.push((r: any) => r[k] === v); return b; }, order() { return b; }, limit() { return b; }, maybeSingle() { one = true; return b; },
      then(res: any) {
        const m = (r: any) => f.every((x) => x(r)); let d: any[] = [];
        if (op === "insert") tables[t].push(...(Array.isArray(payload) ? payload : [payload]));
        else if (op === "delete") { const keep = tables[t].filter((r) => !m(r)); tables[t].length = 0; tables[t].push(...keep); }
        else d = tables[t].filter(m);
        res({ data: one ? d[0] || null : d, error: null });
      },
    }; return b; } };
}
const T: Record<string, any[]> = { calendar_roles: [
  { id: 1, club_name: "甲社", person_key: "總|G", full_name: "總", nickname: "G", role: "governor", managed_club: "" },
  { id: 2, club_name: "甲社", person_key: "秘|S", full_name: "秘", nickname: "S", role: "governor_cc", managed_club: "" },
  { id: 3, club_name: "乙社", person_key: "編|", full_name: "編", nickname: "", role: "district_editor", managed_club: "" },
], calendar_event_types: [], calendar_stat_viewers: [] };
const db = fake(T);
const U = (club: string, key: string) => ({ club, key, name: key.split("|")[0], nickname: key.split("|")[1] });
const reg: any = { roster: async () => ({ ok: false, title: "", persons: [] }), stats: { events: async () => Core.listStatEvents(state), of: async (k: string) => Core.eventStats(state, payments, k) } };
const MEMBERS: any = { 甲社: [{ name: "王", nickname: "" }, { name: "趙", nickname: "Z" }], 乙社: [{ name: "李", nickname: "" }] };
const adm = (action: string, extra: any) => handleAdmin(action, { adminPassword: "pw", ...extra }, { admin: db, password: "pw", members: async () => MEMBERS, clubInfos: async () => [], statEvents: reg.stats.events });

const gi = await handleMember("cal_init", {}, db, U("甲社", "總|G"), reg);
ok("總監：有報名狀況按鈕、可看全部", gi.canStats === true && gi.statAll === true);
ok("總監秘書：可看全部 4 個活動", (await handleMember("cal_stats", {}, db, U("甲社", "秘|S"), reg)).events.length === 4);
const zi = await handleMember("cal_init", {}, db, U("甲社", "趙|Z"), reg);
ok("一般社友：沒有按鈕，呼叫也被擋", zi.canStats === false && await code(handleMember("cal_stats", {}, db, U("甲社", "趙|Z"), reg)) === "CAL_FORBIDDEN");
ok("地區行程管理者沒被指定也看不到", await code(handleMember("cal_stats", {}, db, U("乙社", "編|"), reg)) === "CAL_FORBIDDEN");
const s1 = await adm("cal_admin_statviewers_save", { eventKey: "sports::高爾夫", people: [{ club: "甲社", key: "趙|Z" }, { club: "乙社", key: "李|" }, { club: "甲社", key: "鬼|" }, { club: "甲社", key: "趙|Z" }] });
ok("後台指定：可多選、可跨社，只收社友庫裡的人、不重複", s1.viewers.length === 2 && T.calendar_stat_viewers.every((r: any) => r.event_key === "sports::高爾夫") && s1.events.length === 4);
const zs = await handleMember("cal_stats", {}, db, U("甲社", "趙|Z"), reg);
ok("被指定的人：只看得到被指定的活動", zs.events.length === 1 && zs.events[0].key === "sports::高爾夫" && zs.all === false && zs.events[0].people === 3);
ok("被指定的人：查別的活動被擋、查自己的活動可以", await code(handleMember("cal_stats", { key: "app::上半年分攤金" }, db, U("甲社", "趙|Z"), reg)) === "CAL_FORBIDDEN" && (await handleMember("cal_stats", { key: "sports::高爾夫" }, db, U("甲社", "趙|Z"), reg)).events.length === 1);
const zi2 = await handleMember("cal_init", {}, db, U("甲社", "趙|Z"), reg);
ok("被指定的人：行事曆知道他能看哪些活動", zi2.canStats === true && zi2.statAll === false && zi2.statKeys.join() === "sports::高爾夫");
ok("同名但別社的人不受影響", await code(handleMember("cal_stats", {}, db, U("乙社", "趙|Z"), reg)) === "CAL_FORBIDDEN");
await adm("cal_admin_statviewers_save", { eventKey: "*", people: [{ club: "乙社", key: "編|" }, { club: "乙社", key: "李|" }] });
ok("全部活動：指定後每個活動都看得到（不在社友庫的人不收）", (await handleMember("cal_stats", {}, db, U("乙社", "李|"), reg)).events.length === 4 && await code(handleMember("cal_stats", {}, db, U("乙社", "編|"), reg)) === "CAL_FORBIDDEN");
await adm("cal_admin_statviewers_save", { eventKey: "sports::高爾夫", people: [{ club: "乙社", key: "李|" }] });
ok("重新儲存＝整批取代：趙被移除後看不到", await code(handleMember("cal_stats", {}, db, U("甲社", "趙|Z"), reg)) === "CAL_FORBIDDEN" && T.calendar_stat_viewers.filter((r: any) => r.event_key === "*").length === 1);
ok("不認得的活動、後台密碼錯誤被擋", await code(adm("cal_admin_statviewers_save", { eventKey: "x::y", people: [] })) === "BAD_REQUEST" && await code(handleAdmin("cal_admin_statviewers_get", { adminPassword: "x" }, { admin: db, password: "pw", members: async () => MEMBERS, clubInfos: async () => [] })) === "CAL_ADMIN_AUTH_FAILED");
ok("沒綁定 LINE 的人被擋", (await code(handleMember("cal_stats", {}, db, null, reg))) === "NOT_BOUND");

// ---------- 活動日期（畫面預設只列今天起兩個月內） ----------
{
  const day = (n: number) => new Date(Date.now() + n * 86400e3 + 8 * 3600e3).toISOString().slice(0, 10);
  const regD: any = { ...reg, stats: { events: reg.stats.events, of: async (k: string) => ({ ...Core.eventStats(state, payments, k), date: k === "sports::高爾夫" ? "2030-01-02" : "" }) } };
  T.calendar_events = [
    { registration_key: "seminars::地區訓練講習會", start_at: day(-40) + "T01:00:00Z", status: "confirmed", layer: "district" },
    { registration_key: "seminars::地區訓練講習會", start_at: day(10) + "T01:00:00Z", status: "confirmed", layer: "district" },
    { registration_key: "seminars::地區訓練講習會", start_at: day(3) + "T01:00:00Z", status: "cancelled", layer: "district" },
    { registration_key: "seminars::社長當選人研討會 PELS", start_at: day(-5) + "T01:00:00Z", status: "confirmed", layer: "district" },
  ];
  const r = await handleMember("cal_stats", {}, db, U("甲社", "總|G"), regD);
  const d = (k: string) => r.events.find((e: any) => e.key === k).date;
  ok("日期：主委填的優先；沒填的用行事曆上今天以後最近一場（已取消不算）", d("sports::高爾夫") === "2030-01-02" && d("seminars::地區訓練講習會") === day(10));
  ok("日期：只有過去的行程就取最後一場；分攤金沒有日期", d("seminars::社長當選人研討會 PELS") === day(-5) && d("app::上半年分攤金") === "");
}
