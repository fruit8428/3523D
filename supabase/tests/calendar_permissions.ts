import { handleMember, handleAdmin, handleDesk, icsFeed, buildIcs, AUTO_SYNC_MARK } from "../functions/line-checkin/calendar.ts";
// 極簡假資料庫：支援 select/insert/update/delete/upsert + eq/gte/lte/order/limit/maybeSingle/single
function fake(tables: Record<string, any[]>) {
  let seq = 1000;
  return { from(t: string) {
    tables[t] ||= []; const f: any[] = []; let op = "select", payload: any = null, one = "", conflict: string[] | null = null;
    const run = () => {
      const m = (r: any) => f.every((x) => x(r));
      if (op === "insert") { const list = Array.isArray(payload) ? payload : [payload]; return list.map((pl: any) => { const r = { id: t === "calendar_events" ? "ev" + (seq++) : seq++, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), status: "confirmed", ...pl }; tables[t].push(r); return r; }); }
      if (op === "upsert") { const dup = tables[t].find((r) => (conflict || ["club_name","person_key","role","managed_club"]).every((k) => r[k] === payload[k])); if (!dup) tables[t].push({ id: seq++, granted_at: "x", ...payload }); return []; }
      if (op === "update") { const rs = tables[t].filter(m); rs.forEach((r) => Object.assign(r, payload)); return rs; }
      if (op === "delete") { const keep = tables[t].filter((r) => !m(r)); tables[t].length = 0; tables[t].push(...keep); return []; }
      return tables[t].filter(m);
    };
    const b: any = {
      select() { return b; }, insert(p: any) { op = "insert"; payload = p; return b; }, update(p: any) { op = "update"; payload = p; return b; },
      upsert(p: any, o: any) { op = "upsert"; payload = p; conflict = o && o.onConflict ? o.onConflict.split(",") : null; return b; }, in(k: string, vs: any[]) { f.push((r: any) => vs.includes(r[k])); return b; }, delete() { op = "delete"; return b; },
      eq(k: string, v: any) { f.push((r: any) => r[k] === v); return b; }, gte(k: string, v: any) { f.push((r: any) => r[k] >= v); return b; }, lte(k: string, v: any) { f.push((r: any) => r[k] <= v); return b; },
      order() { return b; }, limit() { return b; }, maybeSingle() { one = "maybe"; return b; }, single() { one = "single"; return b; },
      then(res: any) { const d = run(); res({ data: one ? d[0] || null : d, error: null }); },
    }; return b; } };
}
const T: Record<string, any[]> = { calendar_roles: [], calendar_events: [], calendar_event_types: [{ id: 1, name: "例會", sort_order: 1 }] };
const db = fake(T);
const A = { club: "甲社", key: "王|", name: "王", nickname: "" }, B = { club: "乙社", key: "李|", name: "李", nickname: "" };
const W = { from: "2026-12-01T00:00:00+08:00", to: "2026-12-31T23:59:59+08:00" };
const ev = (o: any) => ({ title: "測試", start: "2026-12-05T19:00:00+08:00", end: "2026-12-05T21:00:00+08:00", ...o });
const code = async (p: Promise<any>) => { try { await p; return "OK"; } catch (e: any) { return e.code || String(e); } };
const ok = (name: string, cond: boolean) => { console.log((cond ? "✅ " : "❌ ") + name); if (!cond) Deno.exitCode = 1; };

ok("一般社友不能新增地區行程", await code(handleMember("cal_save", { event: ev({ layer: "district" }) }, db, A)) === "CAL_FORBIDDEN");
ok("一般社友不能新增社內行程", await code(handleMember("cal_save", { event: ev({ layer: "club", club: "甲社" }) }, db, A)) === "CAL_FORBIDDEN");
await handleMember("cal_save", { event: ev({ layer: "private", title: "A私人" }) }, db, A);
await handleMember("cal_save", { event: ev({ layer: "private", title: "B私人" }) }, db, B);
ok("沒填標題被擋", await code(handleMember("cal_save", { event: ev({ layer: "private", title: " " }) }, db, A)) === "CAL_NEED_TITLE");
ok("結束早於開始被擋", await code(handleMember("cal_save", { event: ev({ layer: "private", end: "2026-12-05T10:00:00+08:00" }) }, db, A)) === "CAL_END_BEFORE_START");
// 指派管理者
const adm = (action: string, extra: any) => handleAdmin(action, { adminPassword: "pw", ...extra }, { admin: db, password: "pw", members: async () => ({ 甲社: [{ name: "王", nickname: "" }], 乙社: [{ name: "李", nickname: "" }] }), clubInfos: async () => [{ name: "甲社", division: "第一分區", code: "01-1" }, { name: "乙社", division: "第一分區", code: "01-2" }] });
ok("後台密碼錯誤被擋", await code(handleAdmin("cal_admin_state", { adminPassword: "x" }, { admin: db, password: "pw", members: async () => ({}), clubInfos: async () => [] })) === "CAL_ADMIN_AUTH_FAILED");
await adm("cal_admin_grant", { club: "甲社", personKey: "王|", role: "club_editor" });
await adm("cal_admin_grant", { club: "乙社", personKey: "李|", role: "district_editor" });
ok("找不到社友不能指派", await code(adm("cal_admin_grant", { club: "甲社", personKey: "鬼|", role: "club_editor" })) === "MEMBER_NOT_FOUND");
await handleMember("cal_save", { event: ev({ layer: "club", club: "甲社", title: "甲社例會" }) }, db, A);
ok("甲社管理者不能新增乙社行程", await code(handleMember("cal_save", { event: ev({ layer: "club", club: "乙社" }) }, db, A)) === "CAL_FORBIDDEN");
await handleMember("cal_save", { event: ev({ layer: "district", title: "地區大會" }) }, db, B);
const la = (await handleMember("cal_list", W, db, A)).events.map((e: any) => e.title).sort();
const lb = (await handleMember("cal_list", W, db, B)).events.map((e: any) => e.title).sort();
ok("甲社看到：地區＋本社＋自己私人，看不到乙的私人", JSON.stringify(la) === JSON.stringify(["A私人", "地區大會", "甲社例會"].sort()));
ok("乙社看到：地區＋自己私人，看不到甲社社內與甲私人", JSON.stringify(lb) === JSON.stringify(["B私人", "地區大會"].sort()));
const dist = (await handleMember("cal_list", W, db, A)).events.find((e: any) => e.title === "地區大會");
ok("甲社不能改／取消／刪除地區行程", (await code(handleMember("cal_save", { event: { ...ev({}), id: dist.id } }, db, A))) === "CAL_FORBIDDEN" && (await code(handleMember("cal_cancel", { id: dist.id }, db, A))) === "CAL_FORBIDDEN" && (await code(handleMember("cal_delete", { id: dist.id }, db, A))) === "CAL_FORBIDDEN");
const bPriv = T.calendar_events.find((e) => e.title === "B私人");
ok("甲不能動乙的私人行程", await code(handleMember("cal_delete", { id: bPriv.id }, db, A)) === "CAL_FORBIDDEN");
const c = await handleMember("cal_cancel", { id: dist.id }, db, B);
ok("地區管理者可取消（狀態 cancelled、未刪除）", c.event.status === "cancelled" && T.calendar_events.some((e) => e.id === dist.id));
ok("可恢復", (await handleMember("cal_cancel", { id: dist.id, cancelled: false }, db, B)).event.status === "confirmed");
ok("時間範圍外不顯示", (await handleMember("cal_list", { from: "2027-01-01T00:00:00+08:00", to: "2027-01-31T00:00:00+08:00" }, db, A)).events.length === 0);
const roleId = T.calendar_roles.find((r) => r.role === "club_editor").id;
await adm("cal_admin_revoke", { id: roleId });
ok("移除後馬上不能新增社內行程", await code(handleMember("cal_save", { event: ev({ layer: "club", club: "甲社" }) }, db, A)) === "CAL_FORBIDDEN");
ok("未綁定的人被擋", await code(handleMember("cal_list", W, db, null)) === "NOT_BOUND");
const st = await adm("cal_admin_state", {});
ok("沒有管理者的社會被列出", st.clubsWithoutEditor.includes("甲社") && st.clubsWithoutEditor.includes("乙社"));

// ---------- 手機行事曆訂閱（.ics） ----------
ok("訂閱預設關閉", (await handleMember("cal_ics_status", {}, db, A)).enabled === false);
const on = await handleMember("cal_ics_set", { enabled: true }, db, A);
ok("開啟後取得 token", on.enabled === true && on.token.length >= 30);
ok("再查狀態拿到同一組 token", (await handleMember("cal_ics_status", {}, db, A)).token === on.token);
const nowIso = (h: number) => new Date(Date.now() + 86400e3 * 2 + h * 3600e3).toISOString();
T.calendar_events.push({ id: "icsA", layer: "private", club_name: "甲社", owner_key: "王|", title: "我的私人,含;符號", start_at: nowIso(0), end_at: nowIso(1), all_day: false, status: "confirmed", location: "某處", notes: "第一行\n第二行", updated_at: nowIso(0) });
T.calendar_events.push({ id: "icsB", layer: "private", club_name: "乙社", owner_key: "李|", title: "別人的私人", start_at: nowIso(0), end_at: nowIso(1), all_day: false, status: "confirmed", updated_at: nowIso(0) });
T.calendar_events.push({ id: "icsD", layer: "district", club_name: "", owner_key: "", title: "地區全天", start_at: new Date(Date.now() + 5 * 86400e3).toISOString(), end_at: new Date(Date.now() + 5 * 86400e3 + 3600e3).toISOString(), all_day: true, status: "cancelled", updated_at: nowIso(0) });
const feed = (await icsFeed(db, on.token)) || "";
ok("訂閱內容含自己的私人與地區行程", feed.includes("UID:icsA@") && feed.includes("UID:icsD@"));
ok("訂閱內容不含別人的私人行程", !feed.includes("icsB") && !feed.includes("別人的私人"));
ok("特殊符號與換行有跳脫", feed.includes("我的私人\\,含\\;符號") && feed.includes("第一行\\n第二行"));
ok("已取消行程標示 CANCELLED、全天用 DATE", feed.includes("STATUS:CANCELLED") && /DTSTART;VALUE=DATE:\d{8}/.test(feed));
ok("每行不超過 75 位元組", feed.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75));
const long = buildIcs([{ id: "x", layer: "club", title: "長".repeat(80), start_at: nowIso(0), end_at: nowIso(1), status: "confirmed" }], {}, "t");
ok("長中文標題折行後不超長", long.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75) && long.includes("\r\n "));
const rot = await handleMember("cal_ics_rotate", {}, db, A);
ok("重新產生後舊網址失效、新網址有效", rot.token !== on.token && (await icsFeed(db, on.token)) === null && !!(await icsFeed(db, rot.token)));
await handleMember("cal_ics_set", { enabled: false }, db, A);
ok("關閉後網址立刻失效", (await icsFeed(db, rot.token)) === null && (await handleMember("cal_ics_status", {}, db, A)).token === null);
ok("再開啟沿用同一組網址", (await handleMember("cal_ics_set", { enabled: true }, db, A)).token === rot.token);
ok("亂猜的 token 無效", (await icsFeed(db, "x".repeat(32))) === null && (await icsFeed(db, "")) === null);
ok("乙社的 token 看不到甲社私人", !((await icsFeed(db, (await handleMember("cal_ics_set", { enabled: true }, db, B)).token)) || "").includes("icsA"));

// ---------- 報名系統裡的行事曆管理（cal_desk_*） ----------
const desk = (action: string, extra: any) => handleDesk(action, extra, { admin: db, password: "pw", checkClub: async (c: string, p: string) => { if (!(c === "甲社" && p === "a123") && !(c === "乙社" && p === "b123")) { const e: any = new Error("x"); e.code = "CLUB_AUTH_FAILED"; throw e; } } });
const dev = (o: any) => ({ title: "桌面行程", start: "2026-12-10T09:00:00+08:00", end: "2026-12-10T10:00:00+08:00", ...o });
ok("社密碼錯誤被擋", await code(desk("cal_desk_list", { club: "甲社", clubPassword: "bad", layer: "club", ...W })) === "CLUB_AUTH_FAILED");
ok("執秘用社密碼可新增本社行程", (await desk("cal_desk_save", { club: "甲社", clubPassword: "a123", event: dev({ layer: "club", club: "甲社", title: "甲社桌面" }) })).event.club === "甲社");
ok("執秘不能新增別社行程", await code(desk("cal_desk_save", { club: "甲社", clubPassword: "a123", event: dev({ layer: "club", club: "乙社" }) })) === "CAL_FORBIDDEN");
ok("執秘不能新增地區行程", await code(desk("cal_desk_save", { club: "甲社", clubPassword: "a123", event: dev({ layer: "district" }) })) === "CAL_FORBIDDEN");
ok("執秘不能列出別社行程", await code(desk("cal_desk_list", { club: "甲社", clubPassword: "a123", layer: "club", targetClub: "乙社", ...W })) === "CAL_FORBIDDEN");
ok("不能用 desk 建立私人行程", await code(desk("cal_desk_save", { adminPassword: "pw", event: dev({ layer: "private" }) })) === "CAL_BAD_LAYER");
ok("後台密碼錯誤被擋", await code(desk("cal_desk_list", { adminPassword: "nope", layer: "district", ...W })) === "CAL_ADMIN_AUTH_FAILED");
const dd = (await desk("cal_desk_save", { adminPassword: "pw", event: dev({ layer: "district", title: "地區桌面" }) })).event;
ok("後台密碼可新增地區行程並列出", (await desk("cal_desk_list", { adminPassword: "pw", layer: "district", ...W })).events.some((e: any) => e.id === dd.id));
ok("後台密碼可管理任何一社", (await desk("cal_desk_list", { adminPassword: "pw", layer: "club", targetClub: "乙社", ...W })).ok === true);
ok("執秘不能改／刪地區行程", await code(desk("cal_desk_delete", { club: "甲社", clubPassword: "a123", id: dd.id })) === "CAL_FORBIDDEN" && await code(desk("cal_desk_cancel", { club: "甲社", clubPassword: "a123", id: dd.id })) === "CAL_FORBIDDEN");
const privId = T.calendar_events.find((e) => e.layer === "private").id;
ok("連後台密碼也不能動私人行程", await code(desk("cal_desk_delete", { adminPassword: "pw", id: privId })) === "CAL_FORBIDDEN");
ok("取消、恢復、刪除", (await desk("cal_desk_cancel", { adminPassword: "pw", id: dd.id })).event.status === "cancelled" && (await desk("cal_desk_cancel", { adminPassword: "pw", id: dd.id, cancelled: false })).event.status === "confirmed" && (await desk("cal_desk_delete", { adminPassword: "pw", id: dd.id })).ok);
ok("沒設後台密碼的地區：後台功能關閉", await code(handleDesk("cal_desk_list", { adminPassword: "x", layer: "district", ...W }, { admin: db, password: "", checkClub: async () => {} })) === "CAL_ADMIN_DISABLED");

// ---------- 社內已報名名單／我要參加 ----------
// 假的報名名單：甲社已正式報名 王（me A）以外的 趙、錢；乙社報名 孫
const ROSTER = [{ club: "甲社", key: "趙|", name: "趙", nickname: "" }, { club: "甲社", key: "錢|", name: "錢", nickname: "Q" }, { club: "乙社", key: "孫|", name: "孫", nickname: "" }];
const reg = { roster: async (k: string) => k === "cat::高球賽" ? { ok: true, title: "高球賽", persons: ROSTER } : { ok: false, title: "", persons: [] } };
const rsvpEv = (await handleMember("cal_save", { event: { ...ev({ layer: "district", title: "地區高爾夫球比賽", registrationKey: "cat::高球賽" }) } }, db, B)).event;
ok("地區管理者可設定對應報名活動", rsvpEv.registrationKey === "cat::高球賽");
const plainEv = (await handleMember("cal_save", { event: { ...ev({ layer: "district", title: "沒有對應" }) } }, db, B)).event;
ok("沒對應報名活動的行程 linked=false", (await handleMember("cal_rsvp_status", { id: plainEv.id }, db, A, reg)).linked === false);
let rs = await handleMember("cal_rsvp_status", { id: rsvpEv.id }, db, A, reg);
ok("甲社只看到甲社已報名的人（趙、錢），看不到乙社的孫", rs.linked && rs.people.map((p: any) => p.name).join() === "趙,錢" && rs.mine === null && rs.registeredCount === 2);
rs = await handleMember("cal_rsvp_set", { id: rsvpEv.id, join: true }, db, A, reg);
ok("我要參加後，名單立刻多一位「表示參加」", rs.mine === "interested" && rs.people.some((p: any) => p.name === "王" && p.status === "interested") && rs.interestedCount === 1);
rs = await handleMember("cal_rsvp_set", { id: rsvpEv.id, join: true }, db, A, reg);
ok("重複按不會多一筆", rs.interestedCount === 1 && T.calendar_rsvp.length === 1);
const stB = await handleMember("cal_rsvp_status", { id: rsvpEv.id }, db, B, reg);
ok("乙社看不到甲社的王", !stB.people.some((p: any) => p.name === "王") && stB.people.map((p: any) => p.name).join() === "孫");
rs = await handleMember("cal_rsvp_set", { id: rsvpEv.id, join: false }, db, A, reg);
ok("可以取消參加", rs.mine === null && rs.interestedCount === 0);
ROSTER.push({ club: "甲社", key: "王|", name: "王", nickname: "" });
ok("執秘送出正式報名後顯示「已報名」，且不能自己取消", (await handleMember("cal_rsvp_status", { id: rsvpEv.id }, db, A, reg)).mine === "registered" && await code(handleMember("cal_rsvp_set", { id: rsvpEv.id, join: false }, db, A, reg)) === "CAL_RSVP_LOCKED");
ROSTER.pop();
await handleMember("cal_rsvp_set", { id: rsvpEv.id, join: true }, db, A, reg);
await handleMember("cal_cancel", { id: rsvpEv.id }, db, B);
ok("行程取消後不能再按我要參加", await code(handleMember("cal_rsvp_set", { id: rsvpEv.id, join: true }, db, { ...A, key: "丙|", name: "丙" }, reg)) === "CAL_EVENT_CANCELLED");
await handleMember("cal_cancel", { id: rsvpEv.id, cancelled: false }, db, B);
const myPriv = T.calendar_events.find((e) => e.layer === "private" && e.owner_key === "王|");
ok("私人行程沒有報名名單功能", await code(handleMember("cal_rsvp_status", { id: myPriv.id }, db, A, reg)) === "CAL_NOT_FOUND");
// 執秘端：讀本社的意願名單
await handleMember("cal_rsvp_set", { id: rsvpEv.id, join: true }, db, { ...A, key: "丙|", name: "丙" }, reg);
const dr = await desk("cal_desk_rsvp", { club: "甲社", clubPassword: "a123", key: "cat::高球賽" });
ok("執秘讀到本社的意願名單（王、丙）", dr.people.map((p: any) => p.name).sort().join() === "丙,王");
ok("執秘讀不到別社的意願", (await desk("cal_desk_rsvp", { club: "乙社", clubPassword: "b123", key: "cat::高球賽" })).people.length === 0);
ok("LINE 手機版編輯行程不會清掉報名對應", (await handleMember("cal_save", { event: { ...ev({ title: "改標題" }), id: rsvpEv.id } }, db, B)).event.registrationKey === "cat::高球賽");
ok("刪除行程後意願名單一併刪除（資料庫 cascade；此處驗證行程可刪）", (await handleMember("cal_delete", { id: rsvpEv.id }, db, B)).ok);

// ---------- 主委活動日期 → 同步成地區行程（cal_desk_sync） ----------
const sync = (extra: any) => handleDesk("cal_desk_sync", extra, {
  admin: db, password: "pw",
  checkClub: async (c: string, p: string) => { if (!(c === "甲社" && p === "a123") && !(c === "乙社" && p === "b123")) { const e: any = new Error("x"); e.code = "CLUB_AUTH_FAILED"; throw e; } },
  roster: async (k: string) => k.startsWith("sports::") ? { ok: true, title: k.split("::")[1], persons: [] } : { ok: false, title: "", persons: [] },
  isChair: async (c: string, k: string) => c === "甲社" && k.startsWith("sports::"),    // 甲社是運動賽事的主委
});
const SK = "sports::1. 地區高爾夫球聯誼賽";
const dsyn = (extra: any) => T.calendar_events.filter((e) => e.registration_key === SK);
ok("非主委的社不能同步日期", await code(sync({ club: "乙社", clubPassword: "b123", key: SK, date: "2026-12-20" })) === "CAL_FORBIDDEN");
ok("主委社密碼錯誤被擋", await code(sync({ club: "甲社", clubPassword: "bad", key: SK, date: "2026-12-20" })) === "CLUB_AUTH_FAILED");
ok("不需要報名的活動（分攤金等）不能同步", await code(sync({ club: "甲社", clubPassword: "a123", key: "apportion::x", date: "2026-12-20" })) === "CAL_FORBIDDEN" && await code(sync({ adminPassword: "pw", key: "apportion::x", date: "2026-12-20" })) === "CAL_REG_UNAVAILABLE");
const s1 = await sync({ club: "甲社", clubPassword: "a123", key: SK, date: "2026-12-20", startTime: "07:30", endTime: "17:00" });
ok("主委填日期時間 → 建立地區行程、對應報名活動、標題為活動名", s1.created && s1.event.layer === "district" && s1.event.title === "1. 地區高爾夫球聯誼賽" && s1.event.registrationKey === SK && !s1.event.allDay && s1.event.start === "2026-12-19T23:30:00.000Z");
const s2 = await sync({ club: "甲社", clubPassword: "a123", key: SK, date: "2026-12-21" });
ok("改日期 → 更新同一筆（不重複建立），沒填時間＝全天", !s2.created && dsyn({}).length === 1 && s2.event.allDay && s2.event.start === "2026-12-20T16:00:00.000Z");
T.calendar_events.find((e) => e.registration_key === SK).title = "管理者改過的標題";
await sync({ club: "甲社", clubPassword: "a123", key: SK, date: "2026-12-22", startTime: "09:00" });
ok("再同步不會蓋掉管理者改過的標題", T.calendar_events.find((e) => e.registration_key === SK).title === "管理者改過的標題");
ok("結束早於開始被擋、格式錯誤被擋", await code(sync({ adminPassword: "pw", key: SK, date: "2026-12-22", startTime: "10:00", endTime: "08:00" })) === "CAL_END_BEFORE_START" && await code(sync({ adminPassword: "pw", key: SK, date: "12/22" })) === "CAL_BAD_TIME");
ok("日期清空 → 移除自動建立的行程", (await sync({ club: "甲社", clubPassword: "a123", key: SK, date: "" })).removed === true && dsyn({}).length === 0);
// 手動建立的行程（非自動）不會被清空日期刪掉，而且會被當作同一筆更新日期
T.calendar_events.push({ id: "manualX", layer: "district", club_name: "", owner_key: "", title: "手動建立", start_at: "2026-12-01T00:00:00.000Z", end_at: "2026-12-01T01:00:00.000Z", all_day: false, status: "confirmed", registration_key: SK, created_by: "某人（地區）", updated_at: "x" });
ok("手動建立的行程：清空日期不會被刪", (await sync({ adminPassword: "pw", key: SK, date: "" })).removed === false && dsyn({}).length === 1);
ok("手動建立的行程：填日期時更新它，不另外新增", !(await sync({ adminPassword: "pw", key: SK, date: "2026-12-25", startTime: "13:00" })).created && dsyn({}).length === 1 && AUTO_SYNC_MARK.length > 0);

// ---------- 我參加的活動 → 私人行事曆 ----------
const jr = [{ club: "甲社", key: "趙|", name: "趙", nickname: "" }];
const jreg = { roster: async (k: string) => k === "cat::羽球賽" ? { ok: true, title: "羽球賽", persons: jr } : { ok: false, title: "", persons: [] } };
const jEv = (await handleMember("cal_save", { event: ev({ layer: "district", title: "地區羽球賽", registrationKey: "cat::羽球賽" }) }, db, B)).event;
const jPlain = (await handleMember("cal_save", { event: ev({ layer: "district", title: "地區無報名" }) }, db, B)).event;
const jClub = (await desk("cal_desk_save", { adminPassword: "pw", event: dev({ layer: "club", club: "乙社", title: "乙社內活動", registrationKey: "cat::羽球賽" }) })).event;
const L = async (me: any) => (await handleMember("cal_list", W, db, me, jreg)).events;
const pick = (evs: any[], id: string) => evs.find((e: any) => e.id === id);
const mkU = (key: string, name: string) => ({ club: "甲社", key, name, nickname: "" });
ok("沒參加的人：joined 為 null", pick(await L(mkU("路人|", "路人")), jEv.id).joined === null);
ok("執秘已正式報名的人（趙）：joined=registered", pick(await L(mkU("趙|", "趙")), jEv.id).joined === "registered");
await handleMember("cal_rsvp_set", { id: jEv.id, join: true }, db, mkU("孫甲|", "孫甲"), jreg);
ok("按了我要參加的人：joined=interested", pick(await L(mkU("孫甲|", "孫甲")), jEv.id).joined === "interested");
ok("沒有對應報名的地區行程：不算參加", pick(await L(mkU("趙|", "趙")), jPlain.id).joined === null);
ok("別人的意願不會讓我的 joined 變動", pick(await L(mkU("路人|", "路人")), jEv.id).joined === null);
await handleMember("cal_rsvp_set", { id: jEv.id, join: false }, db, mkU("孫甲|", "孫甲"), jreg);
ok("取消參加後 joined 回到 null", pick(await L(mkU("孫甲|", "孫甲")), jEv.id).joined === null);
const joinedB = (await handleMember("cal_list", W, db, { club: "乙社", key: "李|", name: "李", nickname: "" }, jreg)).events;
ok("別社的趙不在乙社名單，乙社的李 joined 為 null；社內行程不會洩漏給別社", pick(joinedB, jEv.id).joined === null && pick(await L(mkU("趙|", "趙")), jClub.id) === undefined);

// ---------- 社內例會：開放參加（不需報名活動）＋ 寶尊眷 ----------
const FAM: Record<string, any[]> = { "王|": [{ key: "王妻|", name: "王妻", nickname: "", role: "寶(尊)眷" }, { key: "王子|", name: "王子", nickname: "", role: "寶(尊)眷" }] };
const freg = { roster: jreg.roster, family: async (_c: string, k: string) => FAM[k] || [] };
const meet = (await desk("cal_desk_save", { adminPassword: "pw", event: dev({ layer: "club", club: "甲社", title: "甲社例會(開放參加)", rsvpEnabled: true }) })).event;
const meetClosed = (await desk("cal_desk_save", { adminPassword: "pw", event: dev({ layer: "club", club: "甲社", title: "甲社例會(未開放)" }) })).event;
ok("行程可開放參加（rsvpEnabled）", meet.rsvpEnabled === true && meetClosed.rsvpEnabled === false);
const ME = mkU("王|", "王");
ok("沒開放、也沒對應報名的行程：不能參加", (await handleMember("cal_rsvp_status", { id: meetClosed.id }, db, ME, freg)).linked === false && await code(handleMember("cal_rsvp_set", { id: meetClosed.id, join: true }, db, ME, freg)) === "CAL_REG_UNAVAILABLE");
let m1 = await handleMember("cal_rsvp_status", { id: meet.id }, db, ME, freg);
ok("開放參加的例會：可參加，並列出我的寶尊眷選項（社友庫帶出名字）", m1.linked && m1.mine === null && m1.family.map((f: any) => f.name).join() === "王妻,王子");
ok("自動更新（poll）不讀家人名單", (await handleMember("cal_rsvp_status", { id: meet.id, poll: true }, db, ME, freg)).family === undefined);
m1 = await handleMember("cal_rsvp_set", { id: meet.id, join: true, guestKeys: ["王妻|", "鬼|", "王|"] }, db, ME, freg);
ok("勾選寶眷參加：登記本人＋王妻；不在家人名單的鬼、重複的本人被忽略", m1.mine === "interested" && m1.people.map((p: any) => p.name).sort().join() === "王,王妻" && m1.people.find((p: any) => p.name === "王妻").guestOf === "王|" && m1.people.find((p: any) => p.name === "王妻").role === "寶(尊)眷" && m1.interestedCount === 2);
ok("myGuests 記錄我帶的寶尊眷", m1.myGuests.join() === "王妻|");
m1 = await handleMember("cal_rsvp_set", { id: meet.id, join: true, guestKeys: ["王子|"] }, db, ME, freg);
ok("再更新：改成只帶王子（王妻被取消、王子加入）", m1.people.map((p: any) => p.name).sort().join() === "王,王子");
const spouseView = await handleMember("cal_rsvp_status", { id: meet.id }, db, mkU("王子|", "王子"), freg);
ok("寶尊眷本人（若有綁 LINE）看到自己已在參加名單", spouseView.mine === "interested");
const other = await handleMember("cal_rsvp_status", { id: meet.id }, db, mkU("李四|", "李四"), freg);
ok("同社其他人看得到「王子」是誰的寶尊眷、人數含寶尊眷", other.people.some((p: any) => p.name === "王子" && p.guestOf === "王|") && other.interestedCount === 2);
const otherClub = await handleMember("cal_rsvp_status", { id: meet.id }, db, { club: "乙社", key: "李|", name: "李", nickname: "" }, freg).catch((e: any) => e.code);
ok("例會是社內行程：別社看不到", otherClub === "CAL_NOT_FOUND");
// 已正式報名的寶眷不重複登記
const regGuestEv = (await handleMember("cal_save", { event: ev({ layer: "district", title: "地區羽球賽2", registrationKey: "cat::羽球賽", rsvpEnabled: true }) }, db, B)).event;
jr.push({ club: "甲社", key: "王妻|", name: "王妻", nickname: "" });
const rg = await handleMember("cal_rsvp_set", { id: regGuestEv.id, join: true, guestKeys: ["王妻|", "王子|"] }, db, ME, freg);
ok("執秘已正式報名的寶眷：不重複登記，仍顯示為已報名", rg.people.filter((p: any) => p.name === "王妻").length === 1 && rg.people.find((p: any) => p.name === "王妻").status === "registered" && rg.people.find((p: any) => p.name === "王子").status === "interested");
jr.pop();
// 後台：人數與名單
const dl = (await desk("cal_desk_list", { club: "甲社", clubPassword: "a123", layer: "club", ...W })).events.find((e: any) => e.id === meet.id);
ok("後台行程列表顯示參加人數（含寶尊眷）", dl.rsvpCount === 2);
const dn = await desk("cal_desk_event_rsvp", { club: "甲社", clubPassword: "a123", id: meet.id });
ok("後台可看參加名單（標示寶尊眷）", dn.people.length === 2 && dn.people.some((p: any) => p.name === "王子" && p.guest === true && p.role === "寶(尊)眷"));
ok("乙社執秘看不到甲社例會名單", await code(desk("cal_desk_event_rsvp", { club: "乙社", clubPassword: "b123", id: meet.id })) === "CAL_FORBIDDEN");
m1 = await handleMember("cal_rsvp_set", { id: meet.id, join: false }, db, ME, freg);
ok("取消參加：本人與我帶的寶尊眷一併取消", m1.mine === null && m1.people.length === 0);
await adm("cal_admin_grant", { club: "甲社", personKey: "王|", role: "club_editor" });
const phoneMeet = (await handleMember("cal_save", { event: ev({ layer: "club", club: "甲社", title: "手機開的例會", rsvpEnabled: true }) }, db, A)).event;
ok("手機版：社內管理者新增的例會可開放參加", phoneMeet.rsvpEnabled === true);
const phonePriv = (await handleMember("cal_save", { event: ev({ layer: "private", title: "私人想開放", rsvpEnabled: true }) }, db, A)).event;
ok("私人行程不能開放參加", phonePriv.rsvpEnabled === false);
ok("手機版編輯時不帶 rsvpEnabled 不會把開放關掉", (await handleMember("cal_save", { event: { ...ev({ title: "改標題" }), id: phoneMeet.id } }, db, A)).event.rsvpEnabled === true);

// ---------- 社內例會：實際出席與統計 ----------
const MEMBERS: Record<string, any[]> = {
  "甲社": [{ id: 1, name: "王", nickname: "", role: "社長" }, { id: 2, name: "王子", nickname: "", role: "寶(尊)眷", spouseOfId: 1 }, { id: 3, name: "趙", nickname: "Z", role: "社友" }],
  "乙社": [{ id: 9, name: "李", nickname: "", role: "社友" }],
};
const deskM = (action: string, extra: any) => handleDesk(action, extra, { admin: db, password: "pw", members: async (c: string) => MEMBERS[c] || [],
  checkClub: async (c: string, p: string) => { if (!(c === "甲社" && p === "a123") && !(c === "乙社" && p === "b123")) { const e: any = new Error("x"); e.code = "CLUB_AUTH_FAILED"; throw e; } } });
const A1 = { club: "甲社", clubPassword: "a123" };
const mt1 = (await deskM("cal_desk_save", { ...A1, event: dev({ layer: "club", club: "甲社", title: "例會一", start: "2026-12-02T19:00:00+08:00", end: "2026-12-02T21:00:00+08:00", rsvpEnabled: true }) })).event;
const mt2 = (await deskM("cal_desk_save", { ...A1, event: dev({ layer: "club", club: "甲社", title: "例會二", start: "2026-12-09T19:00:00+08:00", end: "2026-12-09T21:00:00+08:00", rsvpEnabled: true }) })).event;
await handleMember("cal_rsvp_set", { id: mt1.id, join: true, guestKeys: ["王子|"] }, db, mkU("王|", "王"), { roster: jreg.roster, family: async () => [{ key: "王子|", name: "王子", nickname: "", role: "寶(尊)眷" }] });
let ag = await deskM("cal_desk_attend_get", { ...A1, id: mt1.id });
ok("讀出席：尚未記錄、帶出表示參加名單（含寶尊眷）", ag.recorded === false && ag.rsvp.map((x: any) => x.name).sort().join() === "王,王子" && ag.rsvp.find((x: any) => x.name === "王子").guest === true);
ag = await deskM("cal_desk_attend_save", { ...A1, id: mt1.id, keys: ["王|", "趙|Z", "鬼|", "王|"] });
ok("儲存實際出席：只收社友庫裡的人、不重複（鬼被忽略）", ag.recorded && ag.attended.sort().join() === "王|,趙|Z");
ag = await deskM("cal_desk_attend_save", { ...A1, id: mt1.id, keys: ["王|", "王子|"] });
ok("再儲存＝整批取代（趙移除、王子加入），寶尊眷標記 is_guest", ag.attended.sort().join() === "王|,王子|" && T.calendar_attendance.find((x: any) => x.person_key === "王子|").is_guest === true);
ok("乙社不能記錄甲社例會出席", await code(deskM("cal_desk_attend_save", { club: "乙社", clubPassword: "b123", id: mt1.id, keys: ["李|"] })) === "CAL_FORBIDDEN");
ok("地區行程不走這裡（用報到系統）", await code(deskM("cal_desk_attend_get", { adminPassword: "pw", id: jEv.id })) === "CAL_NOT_FOUND");
await deskM("cal_desk_attend_save", { ...A1, id: mt2.id, keys: ["王|", "趙|Z"] });
const st1 = await deskM("cal_desk_stats", { ...A1, from: "2026-12-01T00:00:00+08:00", to: "2026-12-31T23:59:59+08:00" });
const e1 = st1.events.find((e: any) => e.id === mt1.id), e2 = st1.events.find((e: any) => e.id === mt2.id);
ok("統計：列出期間內的例會、每場的表示參加與實際出席", !!e1 && !!e2 && e1.rsvp.length === 2 && e1.attended.length === 2 && e2.attended.length === 2 && e2.recorded);
ok("統計：人名資料齊全（含寶尊眷標記）", st1.people["王子|"].guest === true && st1.people["趙|Z"].nickname === "Z");
ok("統計：乙社看不到甲社（用自己社的密碼只能看自己社）", (await deskM("cal_desk_stats", { club: "乙社", clubPassword: "b123", targetClub: "甲社", from: "2026-12-01T00:00:00+08:00", to: "2026-12-31T23:59:59+08:00" })).club === "乙社");
await deskM("cal_desk_cancel", { ...A1, id: mt2.id });
ok("統計：已取消的例會不算", !(await deskM("cal_desk_stats", { ...A1, from: "2026-12-01T00:00:00+08:00", to: "2026-12-31T23:59:59+08:00" })).events.some((e: any) => e.id === mt2.id));
ok("統計：期間太長被擋", await code(deskM("cal_desk_stats", { ...A1, from: "2025-01-01T00:00:00+08:00", to: "2026-12-31T00:00:00+08:00" })) === "CAL_BAD_TIME");

// ---------- 執秘代為登記參加 ----------
const mt3 = (await deskM("cal_desk_save", { ...A1, event: dev({ layer: "club", club: "甲社", title: "例會三", start: "2026-12-16T19:00:00+08:00", end: "2026-12-16T21:00:00+08:00", rsvpEnabled: true }) })).event;
const mt4 = (await deskM("cal_desk_save", { ...A1, event: dev({ layer: "club", club: "甲社", title: "理事會", start: "2026-12-17T19:00:00+08:00", end: "2026-12-17T21:00:00+08:00", rsvpEnabled: false }) })).event;
await handleMember("cal_rsvp_set", { id: mt3.id, join: true, guestKeys: [] }, db, mkU("王|", "王"), { roster: jreg.roster, family: async () => [{ key: "王子|", name: "王子", nickname: "", role: "寶(尊)眷" }] });
let px = await deskM("cal_desk_proxy_get", { ...A1, id: mt3.id });
ok("代登記：讀到目前名單（王是本人登記）", px.people.length === 1 && px.people[0].key === "王|" && px.people[0].proxy === false);
px = await deskM("cal_desk_proxy_save", { ...A1, id: mt3.id, keys: ["趙|Z", "王子|", "鬼|", "趙|Z"] });
ok("代登記：加入趙與寶尊眷王子，不在社友庫的鬼被忽略、不重複", px.people.map((p: any) => p.key).sort().join() === "王|,王子|,趙|Z" && px.people.find((p: any) => p.key === "趙|Z").proxy === true && px.people.find((p: any) => p.key === "王子|").guest === true && px.people.find((p: any) => p.key === "趙|Z").guest === false);
ok("代登記：記錄是誰代登記的", T.calendar_rsvp.find((r: any) => r.event_id === mt3.id && r.person_key === "趙|Z").proxy_by === "報名系統（甲社）");
px = await deskM("cal_desk_proxy_save", { ...A1, id: mt3.id, keys: ["王子|"] });
ok("代登記：取消趙；社友本人登記的王不會被執秘的儲存刪掉", px.people.map((p: any) => p.key).sort().join() === "王|,王子|");
const zs = await handleMember("cal_rsvp_status", { id: mt3.id }, db, mkU("王|", "王"), { roster: jreg.roster, family: async () => [{ key: "王子|", name: "王子", nickname: "", role: "寶(尊)眷" }] });
ok("LINE 名單標示執秘代登記；王的家人選項顯示王子已登記", zs.people.find((p: any) => p.key === "王子|").proxy === true && zs.family[0].listed === true);
ok("代登記的人計入表示參加人數（列表）", (await deskM("cal_desk_list", { ...A1, layer: "club", targetClub: "甲社", from: "2026-12-16T00:00:00+08:00", to: "2026-12-16T23:59:59+08:00" })).events.find((e: any) => e.id === mt3.id).rsvpCount === 2);
const ag3 = await deskM("cal_desk_attend_get", { ...A1, id: mt3.id });
ok("代登記的人帶入出席勾選預設，並標示是執秘代登記", ag3.rsvp.map((x: any) => x.key).sort().join() === "王|,王子|" && ag3.rsvp.find((x: any) => x.key === "王子|").proxy === true && ag3.rsvp.find((x: any) => x.key === "王|").proxy === false);
ok("代登記：乙社不能幫甲社登記", await code(deskM("cal_desk_proxy_save", { club: "乙社", clubPassword: "b123", id: mt3.id, keys: ["李|"] })) === "CAL_FORBIDDEN");
ok("代登記：沒開放參加的行程不行", await code(deskM("cal_desk_proxy_get", { ...A1, id: mt4.id })) === "CAL_REG_UNAVAILABLE");
ok("代登記：地區行程不走這裡", await code(deskM("cal_desk_proxy_get", { adminPassword: "pw", id: jEv.id })) === "CAL_NOT_FOUND");
await deskM("cal_desk_cancel", { ...A1, id: mt3.id });
ok("代登記：已取消的行程不能再登記", await code(deskM("cal_desk_proxy_save", { ...A1, id: mt3.id, keys: ["趙|Z"] })) === "CAL_EVENT_CANCELLED");
