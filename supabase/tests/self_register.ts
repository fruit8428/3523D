import "../functions/line-checkin/checkin-core.js";
import { handleMember } from "../functions/line-checkin/calendar.ts";
// 極簡假資料庫：支援 select/insert/update/delete/upsert + eq/gte/lte/order/limit/maybeSingle/single
function fake(tables: Record<string, any[]>) {
  let seq = 1000;
  return { from(t: string) {
    tables[t] ||= []; const f: any[] = []; let op = "select", payload: any = null, one = "", conflict: string[] | null = null, upd = false;
    const run = () => {
      const m = (r: any) => f.every((x) => x(r));
      if (op === "insert") { const list = Array.isArray(payload) ? payload : [payload]; return list.map((pl: any) => { const r = { id: t === "calendar_events" ? "ev" + (seq++) : seq++, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), status: "confirmed", ...pl }; tables[t].push(r); return r; }); }
      if (op === "upsert") { const dup = tables[t].find((r) => (conflict || ["club_name","person_key","role","managed_club"]).every((k) => r[k] === payload[k])); if (!dup) tables[t].push({ id: seq++, granted_at: "x", ...payload }); else if (upd) Object.assign(dup, payload); return []; }
      if (op === "update") { const rs = tables[t].filter(m); rs.forEach((r) => Object.assign(r, payload)); return rs; }
      if (op === "delete") { const keep = tables[t].filter((r) => !m(r)); tables[t].length = 0; tables[t].push(...keep); return []; }
      return tables[t].filter(m);
    };
    const b: any = {
      select() { return b; }, insert(p: any) { op = "insert"; payload = p; return b; }, update(p: any) { op = "update"; payload = p; return b; },
      upsert(p: any, o: any) { op = "upsert"; payload = p; conflict = o && o.onConflict ? o.onConflict.split(",") : null; upd = !!(o && o.onConflict && !o.ignoreDuplicates); return b; }, in(k: string, vs: any[]) { f.push((r: any) => vs.includes(r[k])); return b; }, delete() { op = "delete"; return b; },
      eq(k: string, v: any) { f.push((r: any) => r[k] === v); return b; }, gte(k: string, v: any) { f.push((r: any) => r[k] >= v); return b; }, lte(k: string, v: any) { f.push((r: any) => r[k] <= v); return b; },
      order() { return b; }, limit() { return b; }, maybeSingle() { one = "maybe"; return b; }, single() { one = "single"; return b; },
      then(res: any) { const d = run(); res({ data: one ? d[0] || null : d, error: null }); },
    }; return b; } };
}

const Core = (globalThis as any).CheckinCore;
const ok = (name: string, cond: boolean) => { console.log((cond ? "✅ " : "❌ ") + name); if (!cond) Deno.exitCode = 1; };
const code = async (p: Promise<any>) => { try { await p; return "OK"; } catch (e: any) { return e.code || String(e); } };
const mem = (name: string, nickname: string, extra: any = {}) => ({ id: name, name, nickname, role: "社友", diet: "MEAT", veganNote: "", handicap: "", ...extra });

// ---------- 假的報名資料（就是 app_storage 主資料裡的同名欄位） ----------
const state: any = {
  categoriesData: [
    { id: "sports", name: "運動賽事", allowSponsors: true, subEvents: ["高球賽"] },
    { id: "seminars", name: "地區研討會", allowSponsors: false, subEvents: ["社員研習會", "社長當選人研討會 PELS", "研習會分攤金"] },
    { id: "anniv", name: "社慶", allowSponsors: true, subEvents: ["甲社社慶"] },
  ],
  registrationOrders: {},
  chairConfig: { subEventFees: { "sports::高球賽": { feeCompete: 2000, feeMealOnly: 800 }, "seminars::社員研習會": { feeApportionment: 5000 }, "anniv::甲社社慶": { feeAnnivMeal: 1500 } } },
};
const members: any = { 甲社: [mem("王", "Tom"), mem("王太太", "", { role: "寶(尊)眷", spouseOfId: "王", diet: "VEGAN" }), mem("總監", "DG", { handicap: 18 }), mem("陳", "Amy")], 乙社: [mem("李", "")] };
const payments: any = {};
let writes = 0, conflictOnce = false, notReady = false;
// 與 lib.ts 的 selfDeps 相同的流程：讀 → 算 → 寫（這裡直接改記憶體）
const self = {
  info: async (key: string, club: string) => Core.selfRegInfo(state, payments, key, club),
  apply: async (key: string, club: string, change: any) => {
    const info = Core.selfRegInfo(state, payments, key, club);
    const r = Core.selfRegApply(info, members[club] || [], club, change, "2026-11-24 15:00");
    if (!r.ok || !r.changed) return r;
    if (notReady) return { ok: false, code: "REG_SELF_NOT_READY" };
    const list = (state.registrationOrders[info.subName] ||= []);
    const i = list.findIndex((o: any) => o.clubName === club);
    if (r.after === null) { if (i >= 0) list.splice(i, 1); } else if (i >= 0) list[i] = r.after; else list.push(r.after);
    writes++;
    return r;
  },
};
const fam = async (club: string, key: string) => {
  const list = members[club] || [], me = list.find((m: any) => `${m.name}|${m.nickname}` === key); if (!me) return [];
  const head = me.spouseOfId || me.id;
  return list.filter((m: any) => m !== me && (m.id === head || m.spouseOfId === head)).map((m: any) => ({ key: `${m.name}|${m.nickname}`, name: m.name, nickname: m.nickname, role: m.role }));
};
const reg: any = {
  roster: async (k: string) => { const ro = Core.buildRoster(state, k); return { ok: !!ro.ok, title: ro.title || "", persons: ro.persons || [], isPels: !!ro.isPels }; },
  family: fam, self,
};
const orderOf = (sub: string, club: string) => (state.registrationOrders[sub] || []).find((o: any) => o.clubName === club) || null;
const names = (sub: string, club: string) => ((orderOf(sub, club) || {}).items || []).map((i: any) => i.name).join();

// ---------- 一、算法（checkin-core.js） ----------
let info = Core.selfRegInfo(state, payments, "sports::高球賽", "甲社");
ok("運動賽事：可手機報名、要選參賽或只用餐、帶出主委設定的費用", info.ok && info.sports && info.perHead && info.fees.compete === 2000 && info.fees.mealOnly === 800);
ok("分攤金：不開放", Core.selfRegInfo(state, payments, "seminars::研習會分攤金", "甲社").reason === "apportionment");
ok("PELS：不開放（只能由執秘報名）", Core.selfRegInfo(state, payments, "seminars::社長當選人研討會 PELS", "甲社").reason === "pels");
ok("不存在的活動：不開放", Core.selfRegInfo(state, payments, "sports::沒有這個", "甲社").reason === "no_event");
let r = Core.selfRegApply(info, members.甲社, "甲社", { ensure: [{ key: "王|Tom", participation: "只用餐", by: "LINE 王" }] }, "t1");
ok("第一位報名：建立報名表，金額＝只用餐費用", r.ok && r.before === null && r.after.items.length === 1 && r.after.participantFee === 800 && r.after.grandTotal === 800 && r.after.sponsorTier === "PARTICIPANT");
ok("報名表上的人帶社友庫欄位與來源標記", r.after.items[0].participation === "只用餐" && r.after.items[0].fee === 800 && r.after.items[0].via === "line" && r.after.items[0].lineBy === "LINE 王");
ok("不在社友庫的人不會被加入", Core.selfRegApply(info, members.甲社, "甲社", { ensure: [{ key: "路人|X" }] }, "t").changed === false);
ok("PELS 套用被擋", Core.selfRegApply(Core.selfRegInfo(state, payments, "seminars::社長當選人研討會 PELS", "甲社"), members.甲社, "甲社", { ensure: [{ key: "王|Tom" }] }, "t").code === "REG_SECRETARY_ONLY");
// 既有報名表（執秘送出的，含贊助）
state.registrationOrders["高球賽"] = [{ clubName: "甲社", sponsorTier: "SPONSOR", sponsorAmount: 10000, participantFee: 2000, apportionmentFee: 0, grandTotal: 12000, submittedAt: "t0", prizeSponsors: [], items: [{ name: "陳", nickname: "Amy", participation: "參賽", fee: 2000 }] }];
info = Core.selfRegInfo(state, payments, "sports::高球賽", "甲社");
r = Core.selfRegApply(info, members.甲社, "甲社", { ensure: [{ key: "王|Tom", participation: "參賽" }] }, "t2");
ok("加入既有報名表：只加人頭費，贊助金額不動", r.after.items.length === 2 && r.after.participantFee === 4000 && r.after.grandTotal === 14000 && r.after.sponsorAmount === 10000 && r.before.items.length === 1);
r = Core.selfRegApply(info, members.甲社, "甲社", { ensure: [{ key: "陳|Amy", participation: "只用餐" }] }, "t3");
ok("改參加方式：費用跟著改", r.updated.join() === "陳|Amy" && r.after.items[0].fee === 800 && r.after.grandTotal === 10800);
r = Core.selfRegApply(info, members.甲社, "甲社", { remove: ["陳|Amy"] }, "t4");
ok("取消後沒有人但有贊助：報名表保留", r.after !== null && r.after.items.length === 0 && r.after.grandTotal === 10000);
payments["sports::高球賽"] = { 甲社: { status: "PAID_MANUAL" } };
info = Core.selfRegInfo(state, payments, "sports::高球賽", "甲社");
ok("已繳費＋收人頭費：不能再加人", Core.selfRegApply(info, members.甲社, "甲社", { ensure: [{ key: "王|Tom", participation: "參賽" }] }, "t").code === "REG_PAID_LOCKED");
ok("已繳費＋收人頭費：不能取消", Core.selfRegApply(info, members.甲社, "甲社", { remove: ["陳|Amy"] }, "t").code === "REG_PAID_LOCKED");
delete payments["sports::高球賽"]; state.registrationOrders = {};
// 研討會：每社固定金額
info = Core.selfRegInfo(state, payments, "seminars::社員研習會", "甲社");
r = Core.selfRegApply(info, members.甲社, "甲社", { ensure: [{ key: "王|Tom" }, { key: "陳|Amy" }] }, "t5");
ok("研討會：不收人頭費，金額＝主委設定的每社應繳金額", !info.perHead && r.after.participantFee === 0 && r.after.apportionmentFee === 5000 && r.after.grandTotal === 5000 && r.after.items.length === 2);
payments["seminars::社員研習會"] = { 甲社: { status: "PAID_EMAIL" } };
ok("研討會已繳費仍可加人（金額不變）", Core.selfRegApply(Core.selfRegInfo(state, payments, "seminars::社員研習會", "甲社"), members.甲社, "甲社", { ensure: [{ key: "王|Tom" }] }, "t").ok);
delete payments["seminars::社員研習會"];
info = Core.selfRegInfo(state, payments, "anniv::甲社社慶", "甲社");
r = Core.selfRegApply(info, members.甲社, "甲社", { ensure: [{ key: "王|Tom", participation: "只用餐" }] }, "t6");
ok("社慶：每人收社慶餐費，不分參賽／只用餐", info.anniv && !info.sports && r.after.items[0].fee === 1500 && r.after.grandTotal === 1500);

// ---------- 二、LINE 動作（calendar.ts） ----------
const T: Record<string, any[]> = { calendar_roles: [], calendar_event_types: [], calendar_rsvp: [], calendar_events: [
  { id: "g1", layer: "district", club_name: "", owner_key: "", title: "高球賽", status: "confirmed", registration_key: "sports::高球賽", rsvp_enabled: true },
  { id: "p1", layer: "district", club_name: "", owner_key: "", title: "PELS", status: "confirmed", registration_key: "seminars::社長當選人研討會 PELS", rsvp_enabled: true },
  { id: "m1", layer: "club", club_name: "甲社", owner_key: "", title: "例會", status: "confirmed", registration_key: null, rsvp_enabled: true },
] };
const db = fake(T);
const A = { club: "甲社", key: "王|Tom", name: "王", nickname: "Tom" }, C = { club: "甲社", key: "陳|Amy", name: "陳", nickname: "Amy" }, B = { club: "乙社", key: "李|", name: "李", nickname: "" };
let st = await handleMember("cal_rsvp_status", { id: "g1" }, db, A, reg);
ok("狀態：可直接報名、要選參賽／只用餐、帶出費用", st.linked && st.self.allowed && st.self.sports && st.self.fees.compete === 2000 && st.mine === null && !st.self.locked);
T.calendar_rsvp.push({ event_id: "g1", club_name: "甲社", person_key: "陳|Amy", full_name: "陳", nickname: "Amy", guest_of: "", guest_role: "", proxy_by: "" });
st = await handleMember("cal_rsvp_status", { id: "g1" }, db, C, reg);
ok("舊的「表示參加」紀錄不再顯示（不在報名表＝沒報名）", st.mine === null && st.people.length === 0);
ok("列表上也不算參加", (await handleMember("cal_list", { from: "2020-01-01T00:00:00Z", to: "2020-06-01T00:00:00Z" }, db, C, reg)).ok);
st = await handleMember("cal_rsvp_set", { id: "g1", join: true, parts: { "王|Tom": "只用餐" } }, db, A, reg);
ok("按報名：直接進報名表，狀態＝已報名", st.mine === "registered" && names("高球賽", "甲社") === "王" && orderOf("高球賽", "甲社").grandTotal === 800 && st.registeredCount === 1);
st = await handleMember("cal_rsvp_set", { id: "g1", join: true, parts: { "王|Tom": "參賽", "王太太|": "只用餐" }, guestKeys: ["王太太|", "陳|Amy"] }, db, A, reg);
ok("改成參賽並帶寶尊眷：只收家人（別人的 key 忽略），金額正確", names("高球賽", "甲社") === "王,王太太" && orderOf("高球賽", "甲社").grandTotal === 2800 && st.myGuests.join() === "王太太|" && st.self.parts["王|Tom"] === "參賽");
ok("家人選項：我帶的寶尊眷可以取消勾選", st.family.length === 1 && st.family[0].registered === false);
st = await handleMember("cal_rsvp_set", { id: "g1", join: true, parts: {}, guestKeys: [] }, db, A, reg);
ok("取消勾選寶尊眷：寶尊眷移出，本人保留、參加方式不變", names("高球賽", "甲社") === "王" && orderOf("高球賽", "甲社").grandTotal === 2000);
await handleMember("cal_rsvp_set", { id: "g1", join: true, parts: { "陳|Amy": "參賽" } }, db, C, reg);
ok("另一位社友報名：加進同一張報名表，並清掉他舊的表示參加紀錄", names("高球賽", "甲社") === "王,陳" && T.calendar_rsvp.length === 0);
ok("別社的人報名：各自一張", (await handleMember("cal_rsvp_set", { id: "g1", join: true, parts: {} }, db, B, reg)).mine === "registered" && names("高球賽", "乙社") === "李" && names("高球賽", "甲社") === "王,陳");
// 執秘在報名系統把人拿掉 → 手機同步
orderOf("高球賽", "甲社").items = orderOf("高球賽", "甲社").items.filter((i: any) => i.name !== "王");
st = await handleMember("cal_rsvp_status", { id: "g1" }, db, A, reg);
ok("執秘把人從報名表拿掉：手機不再顯示已報名", st.mine === null && st.people.map((p: any) => p.name).join() === "陳");
// 已繳費鎖定
payments["sports::高球賽"] = { 甲社: { status: "PAID_MANUAL" } };
st = await handleMember("cal_rsvp_status", { id: "g1" }, db, C, reg);
ok("該社已繳費：狀態標示鎖定", st.self.locked === true && st.mine === "registered");
ok("該社已繳費：手機不能取消", await code(handleMember("cal_rsvp_set", { id: "g1", join: false }, db, C, reg)) === "CAL_RSVP_PAID_LOCKED" && names("高球賽", "甲社") === "陳");
ok("該社已繳費：手機不能再報名", await code(handleMember("cal_rsvp_set", { id: "g1", join: true, parts: {} }, db, A, reg)) === "CAL_RSVP_PAID_LOCKED");
delete payments["sports::高球賽"];
st = await handleMember("cal_rsvp_set", { id: "g1", join: false }, db, C, reg);
ok("未繳費：手機可以取消，最後一人取消後報名表移除", st.mine === null && orderOf("高球賽", "甲社") === null);
ok("綁定的名字不在社友庫：不能報名", await code(handleMember("cal_rsvp_set", { id: "g1", join: true, parts: {} }, db, { club: "甲社", key: "舊名|X", name: "舊名", nickname: "X" }, reg)) === "CAL_REG_NOT_MEMBER");
notReady = true;
ok("資料庫函式還沒建立：回尚未啟用", await code(handleMember("cal_rsvp_set", { id: "g1", join: true, parts: {} }, db, A, reg)) === "CAL_REG_NOT_READY");
notReady = false;
T.calendar_events[0].status = "cancelled";
ok("行程已取消：不能報名", await code(handleMember("cal_rsvp_set", { id: "g1", join: true, parts: {} }, db, A, reg)) === "CAL_EVENT_CANCELLED");
T.calendar_events[0].status = "confirmed";
// PELS
st = await handleMember("cal_rsvp_status", { id: "p1" }, db, A, reg);
ok("PELS：狀態標示只能由執秘報名", st.linked && st.self.allowed === false && st.self.reason === "pels");
ok("PELS：手機報名被擋", await code(handleMember("cal_rsvp_set", { id: "p1", join: true }, db, A, reg)) === "CAL_REG_SECRETARY_ONLY");
// 沒有對應報名活動的行程（例會）：維持原本的登記方式
st = await handleMember("cal_rsvp_set", { id: "m1", join: true }, db, A, reg);
ok("例會（沒有對應報名表）：照舊登記在行事曆，不寫報名表", st.mine === "interested" && st.self === undefined && T.calendar_rsvp.length === 1);
await handleMember("cal_rsvp_set", { id: "m1", join: false }, db, A, reg);
// 總監秘書
T.calendar_roles.push({ club_name: "甲社", person_key: "總監|DG", full_name: "總監", nickname: "DG", role: "governor", managed_club: "" }, { club_name: "甲社", person_key: "王|Tom", full_name: "王", nickname: "Tom", role: "governor_cc", managed_club: "" });
st = await handleMember("cal_rsvp_set", { id: "g1", join: true, parts: { "王|Tom": "參賽" }, withGov: true }, db, A, reg);
ok("總監秘書報名並同步總監：兩人都進報名表", names("高球賽", "甲社") === "王,總監" && st.gov.joined && st.gov.byMe && orderOf("高球賽", "甲社").items[1].handicap === 18);
st = await handleMember("cal_rsvp_set", { id: "g1", join: true, parts: {}, withGov: false }, db, A, reg);
ok("取消同步：只收回我代總監報的", names("高球賽", "甲社") === "王" && !st.gov.joined);
const G = { forGov: { club: "甲社", key: "總監|DG" } };
ok("在總監行事曆幫總監報名：運動賽事要先選參加方式", await code(handleMember("cal_gov_rsvp", { id: "g1", join: true, ...G }, db, A, reg)) === "CAL_REG_NEED_PART");
ok("選了參加方式後：總監進報名表", (await handleMember("cal_gov_rsvp", { id: "g1", join: true, participation: "只用餐", ...G }, db, A, reg)).joined === "registered" && names("高球賽", "甲社") === "王,總監");
ok("在總監行事曆取消：總監移出報名表", (await handleMember("cal_gov_rsvp", { id: "g1", join: false, ...G }, db, A, reg)).joined === null && names("高球賽", "甲社") === "王");
await handleMember("cal_rsvp_set", { id: "g1", join: true, parts: {}, withGov: true }, db, A, reg);
await handleMember("cal_rsvp_set", { id: "g1", join: false }, db, A, reg);
ok("秘書取消自己的報名：代總監報的一併取消", orderOf("高球賽", "甲社") === null);
// ---------- 三、報名截止 ----------
const NOW = Date.parse("2026-11-26T12:00:00+08:00");
const cfg: any = { regDeadlines: { "a::1": "2026-11-26T11:59", "a::2": "2026-11-26T12:01", "a::bad": "明天" }, eventDates: { "a::3": { date: "2026-11-26" }, "a::4": { date: "2026-11-27" }, "a::2": { date: "2026-11-20" } } };
ok("截止時間已過：已截止", Core.regClosed(cfg, "a::1", NOW) === true);
ok("截止時間未到：未截止（即使活動日期比較早，也以主委設定的截止時間為準）", Core.regClosed(cfg, "a::2", NOW) === false && Core.regDeadlineOf(cfg, "a::2").source === "set");
ok("沒設截止、有活動日期：活動當天 00:00 截止", Core.regClosed(cfg, "a::3", NOW) === true && Core.regDeadlineOf(cfg, "a::3").source === "eventDay");
ok("沒設截止、活動在明天：還沒截止", Core.regClosed(cfg, "a::4", NOW) === false);
ok("兩個都沒設、或格式不對：不截止", Core.regClosed(cfg, "a::none", NOW) === false && Core.regClosed(cfg, "a::bad", NOW) === false && Core.regDeadlineOf({}, "x").at === null);
ok("截止時間文字（台灣時間）", Core.regDeadlineText(Date.parse("2026-12-03T18:00:00+08:00")) === "12/3（四）18:00" && Core.regDeadlineText(null) === "");
state.registrationOrders = {}; T.calendar_roles.length = 0;
await handleMember("cal_rsvp_set", { id: "g1", join: true, parts: { "王|Tom": "參賽" } }, db, A, reg);
state.chairConfig.regDeadlines = { "sports::高球賽": "2020-01-01T23:59" };
st = await handleMember("cal_rsvp_status", { id: "g1" }, db, A, reg);
ok("狀態：標示已截止並帶出截止時間", st.self.closed === true && st.self.deadline === "2020-01-01T15:59:00.000Z" && st.self.deadlineSource === "set" && st.mine === "registered");
ok("已截止：手機不能取消", await code(handleMember("cal_rsvp_set", { id: "g1", join: false }, db, A, reg)) === "CAL_REG_CLOSED" && names("高球賽", "甲社") === "王");
ok("已截止：手機不能報名", await code(handleMember("cal_rsvp_set", { id: "g1", join: true, parts: {} }, db, C, reg)) === "CAL_REG_CLOSED");
ok("已截止：不能改參加方式", await code(handleMember("cal_rsvp_set", { id: "g1", join: true, parts: { "王|Tom": "只用餐" } }, db, A, reg)) === "CAL_REG_CLOSED" && orderOf("高球賽", "甲社").items[0].participation === "參賽");
state.chairConfig.regDeadlines = { "sports::高球賽": "2099-01-01T23:59" };
st = await handleMember("cal_rsvp_status", { id: "g1" }, db, A, reg);
ok("截止時間還沒到：可以取消，狀態帶出截止時間", st.self.closed === false && !!st.self.deadline && (await handleMember("cal_rsvp_set", { id: "g1", join: false }, db, A, reg)).mine === null);
delete state.chairConfig.regDeadlines;
state.chairConfig.eventDates = { "sports::高球賽": { date: "2020-01-01" } };
ok("沒設截止、活動日期已過：手機不能報名", await code(handleMember("cal_rsvp_set", { id: "g1", join: true, parts: {} }, db, A, reg)) === "CAL_REG_CLOSED");
delete state.chairConfig.eventDates;
console.log("寫入次數", writes);
