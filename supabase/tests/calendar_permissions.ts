import { handleMember, handleAdmin, handleDesk, icsFeed, buildIcs, AUTO_SYNC_MARK } from "../functions/line-checkin/calendar.ts";
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
// 執秘把人從報名表移除後，取消他在 LINE 按的「我要參加」
const deskR = (action: string, extra: any) => handleDesk(action, extra, { admin: db, password: "pw", roster: async () => ({ ok: true, title: "高球賽", persons: ROSTER }), checkClub: async (c: string, p: string) => { if (!(c === "甲社" && p === "a123") && !(c === "乙社" && p === "b123")) { const e: any = new Error("x"); e.code = "CLUB_AUTH_FAILED"; throw e; } } } as any);
const rsvpNames = async () => (await desk("cal_desk_rsvp", { club: "甲社", clubPassword: "a123", key: "cat::高球賽" })).people.map((p: any) => p.name).sort().join();
ok("取消意願：沒給名單被擋", await code(deskR("cal_desk_rsvp_cancel", { club: "甲社", clubPassword: "a123", key: "cat::高球賽", keys: [] })) === "BAD_REQUEST");
ok("取消意願：別社的執秘動不到本社的人", (await deskR("cal_desk_rsvp_cancel", { club: "乙社", clubPassword: "b123", key: "cat::高球賽", keys: ["王|"] })).removed === 0 && await rsvpNames() === "丙,王");
ROSTER.push({ club: "甲社", key: "王|", name: "王", nickname: "" });
const keepR = await deskR("cal_desk_rsvp_cancel", { club: "甲社", clubPassword: "a123", key: "cat::高球賽", keys: ["王|"] });
ok("取消意願：還在正式報名名單上的人不動", keepR.removed === 0 && keepR.kept === 1 && await rsvpNames() === "丙,王");
ROSTER.pop();
const cutR = await deskR("cal_desk_rsvp_cancel", { club: "甲社", clubPassword: "a123", key: "cat::高球賽", keys: ["王|"] });
ok("取消意願：只取消指定的人，其他人保留", cutR.removed === 1 && await rsvpNames() === "丙");
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
ok("主委填日期時間 → 建立地區行程、對應報名活動、開放參加、標題為活動名", s1.created && s1.event.layer === "district" && s1.event.title === "1. 地區高爾夫球聯誼賽" && s1.event.registrationKey === SK && s1.event.rsvpEnabled === true && !s1.event.allDay && s1.event.start === "2026-12-19T23:30:00.000Z");
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

// ---------- 代登記：同行的非社友（子女、外勞、朋友、沒有資料的寶尊眷） ----------
const mt5 = (await deskM("cal_desk_save", { ...A1, event: dev({ layer: "club", club: "甲社", title: "例會五", start: "2026-12-23T19:00:00+08:00", end: "2026-12-23T21:00:00+08:00", rsvpEnabled: true }) })).event;
await handleMember("cal_rsvp_set", { id: mt5.id, join: true, guestKeys: ["王子|"] }, db, mkU("王|", "王"), { roster: jreg.roster, family: async () => [{ key: "王子|", name: "王子", nickname: "", role: "寶(尊)眷" }] });
let g5 = await deskM("cal_desk_proxy_save", { ...A1, id: mt5.id, keys: ["趙|Z"], guests: [
  { host: "趙|Z", type: "寶(尊)眷", name: "趙太太" }, { host: "趙|Z", type: "外勞", name: "" }, { host: "王|", type: "子女", name: "王小妹" },
  { host: "鬼|", type: "朋友", name: "x" }, { host: "趙|Z", type: "亂寫", name: "y" }, { host: "李|", type: "朋友", name: "z" } ] });
const ext = g5.people.filter((p: any) => p.ext);
ok("同行者：趙帶寶尊眷＋外勞、王（本人在 LINE 登記）帶子女；不在社友庫的帶人者、亂寫的類別、沒參加的人帶的都忽略", ext.length === 3 && ext.map((p: any) => p.name).sort().join() === ["王小妹", "Z的外勞", "趙太太"].sort().join());
if (ext.length !== 3) console.log("  實際：", ext.map((p: any) => p.name));
ok("同行者：標示帶他的人、類別、執秘代登記、算寶尊眷", ext.find((p: any) => p.name === "Z的外勞").guestOf === "趙|Z" && ext.find((p: any) => p.name === "Z的外勞").role === "外勞" && ext.every((p: any) => p.proxy && p.guest));
const st5 = await handleMember("cal_rsvp_status", { id: mt5.id }, db, mkU("王|", "王"), { roster: jreg.roster, family: async () => [{ key: "王子|", name: "王子", nickname: "", role: "寶(尊)眷" }] });
ok("LINE：王看得到同行者，但「我帶的寶尊眷」只有王子（執秘代登記的子女不算，改寶尊眷時不會被刪）", st5.people.some((p: any) => p.name === "王小妹" && p.role === "子女") && st5.myGuests.join() === "王子|");
await handleMember("cal_rsvp_set", { id: mt5.id, join: true, guestKeys: [] }, db, mkU("王|", "王"), { roster: jreg.roster, family: async () => [{ key: "王子|", name: "王子", nickname: "", role: "寶(尊)眷" }] });
ok("LINE：王取消帶王子，執秘代登記的王小妹仍在", (await deskM("cal_desk_proxy_get", { ...A1, id: mt5.id })).people.map((p: any) => p.name).includes("王小妹") && !(await deskM("cal_desk_proxy_get", { ...A1, id: mt5.id })).people.some((p: any) => p.name === "王子"));
g5 = await deskM("cal_desk_proxy_save", { ...A1, id: mt5.id, keys: ["趙|Z"] });
ok("舊版畫面沒送 guests：同行者不動", g5.people.filter((p: any) => p.ext).length === 3);
const ag5 = await deskM("cal_desk_attend_save", { ...A1, id: mt5.id, keys: ["趙|Z", ext.find((p: any) => p.name === "趙太太").key, "guest:假的|:1"] });
ok("記錄出席：同行者可以記錄（算寶尊眷），不存在的同行者被忽略", ag5.attended.length === 2 && T.calendar_attendance.find((x: any) => x.event_id === mt5.id && x.full_name === "趙太太").is_guest === true && T.calendar_attendance.find((x: any) => x.event_id === mt5.id && x.full_name === "趙太太").role === "寶(尊)眷");
g5 = await deskM("cal_desk_proxy_save", { ...A1, id: mt5.id, keys: [], guests: [{ host: "趙|Z", type: "朋友", name: "老朋友" }, { host: "王|", type: "子女", name: "王小妹" }] });
ok("取消勾選趙：趙帶的人一起移除（朋友也不收），王帶的子女保留", g5.people.filter((p: any) => p.ext).map((p: any) => p.name).join() === "王小妹" && !g5.people.some((p: any) => p.key === "趙|Z"));

// ---------- 出席率報表（例會＋地區活動補出席） ----------
const rk = (m: string, d: string) => ({ layer: "club", club: "甲社", title: m, start: `2027-${d}T19:00:00+08:00`, end: `2027-${d}T21:00:00+08:00`, rsvpEnabled: true });
const ma = (await deskM("cal_desk_save", { ...A1, event: dev(rk("一月例會", "01-06")) })).event;
const mb = (await deskM("cal_desk_save", { ...A1, event: dev(rk("二月例會", "02-03")) })).event;
const mc = (await deskM("cal_desk_save", { ...A1, event: dev(rk("三月例會", "03-03")) })).event;
await deskM("cal_desk_attend_save", { ...A1, id: ma.id, keys: ["王|", "王子|"] });
await deskM("cal_desk_attend_save", { ...A1, id: mb.id, keys: ["趙|Z"] });
T.event_checkins = [
  { event_key: "sports::地區高球", club_name: "甲社", person_key: "王|", full_name: "王", nickname: "", status: "in", checked_in_at: "2027-02-10T01:00:00.000Z" },
  { event_key: "seminar::地區研習", club_name: "甲社", person_key: "王|", full_name: "王", nickname: "", status: "in", checked_in_at: "2027-04-01T01:00:00.000Z" },
  { event_key: "sports::地區高球", club_name: "甲社", person_key: "趙|Z", full_name: "趙", nickname: "Z", status: "cancelled", checked_in_at: "2027-02-10T01:00:00.000Z" },
  { event_key: "sports::地區高球", club_name: "乙社", person_key: "李|", full_name: "李", nickname: "", status: "in", checked_in_at: "2027-02-10T01:00:00.000Z" },
];
const PER = [{ id: "h1", from: "2027-01-01T00:00:00+08:00", to: "2027-03-31T23:59:59+08:00" }, { id: "year", from: "2027-01-01T00:00:00+08:00", to: "2027-06-30T23:59:59+08:00" }];
const regM = { roster: jreg.roster, members: async (c: string) => MEMBERS[c] || [] };
const zr = await handleMember("cal_attend_report", { scope: "me", periods: PER }, db, { club: "甲社", key: "趙|Z", name: "趙", nickname: "Z" }, regM);
ok("出席率（社友本人）：只回傳自己，沒有全社權限", zr.people.length === 1 && zr.people[0].key === "趙|Z" && zr.canClub === false && zr.district.length === 0);
ok("出席率：趙 例會 1/2、取消的報到不算補出席 → 50%", zr.people[0].sum.h1.held === 2 && zr.people[0].sum.h1.attended === 1 && zr.people[0].sum.h1.makeup === 0 && zr.people[0].sum.h1.rate === 0.5);
ok("出席率：一般社友不能看全社", await code(handleMember("cal_attend_report", { scope: "club", periods: PER }, db, { club: "甲社", key: "趙|Z", name: "趙", nickname: "Z" }, regM)) === "CAL_FORBIDDEN");
const wr = await handleMember("cal_attend_report", { scope: "club", periods: PER }, db, mkU("王|", "王"), regM);
const w = wr.people.find((p: any) => p.key === "王|");
ok("出席率（社長）：看得到全社（王、王子、趙），社長排第一", wr.canClub === true && wr.people[0].key === "王|" && ["王子|", "趙|Z"].every((k) => wr.people.some((p: any) => p.key === k)));

// ---------- Excel 匯入行程 ----------
const imp = (o: any) => ({ title: "匯入例會", start: "2027-02-03T19:00:00+08:00", end: "2027-02-03T21:00:00+08:00", ...o });
const nEv0 = T.calendar_events.length;
const id1 = await deskM("cal_desk_import", { ...A1, layer: "club", events: [imp({ row: 2 }), imp({ row: 3, title: "社遊", rsvpEnabled: false, typeId: 999 }), imp({ row: 4 }), imp({ row: 5, title: "" }), imp({ row: 6, end: "2027-02-03T18:00:00+08:00" })], dryRun: true });
ok("匯入預覽（dryRun）：不寫入；同檔重複、缺標題、時間顛倒都列出原因", T.calendar_events.length === nEv0 && id1.willImport.join() === "2,3" && id1.skipped.map((x: any) => x.row + x.reason).join() === "4DUP_IN_FILE:2,5CAL_NEED_TITLE,6CAL_END_BEFORE_START");
const id2 = await deskM("cal_desk_import", { ...A1, layer: "club", targetClub: "乙社", events: [imp({ row: 2 }), imp({ row: 3, title: "社遊", rsvpEnabled: false, typeId: 999 })] });
const got = T.calendar_events.slice(nEv0);
ok("匯入：寫入 2 筆，只進自己的社（帶別社名稱也一樣）、記錄匯入者", id2.imported === 2 && got.length === 2 && got.every((e: any) => e.layer === "club" && e.club_name === "甲社" && e.created_by === "報名系統（甲社）"));
ok("匯入：預設開放我要參加，填否的關閉；不存在的類型改成未分類", got.find((e: any) => e.title === "匯入例會").rsvp_enabled === true && got.find((e: any) => e.title === "社遊").rsvp_enabled === false && got.find((e: any) => e.title === "社遊").event_type_id === null);
const id3 = await deskM("cal_desk_import", { ...A1, layer: "club", events: [imp({ row: 2 }), imp({ row: 3, title: "新的一筆" })] });
ok("再匯入同一份：已有的略過（DUP_EXISTING），只新增新的", id3.imported === 1 && id3.skipped.length === 1 && id3.skipped[0].reason === "DUP_EXISTING" && T.calendar_events.length === nEv0 + 3);
ok("社密碼不能匯入地區行程", await code(deskM("cal_desk_import", { ...A1, layer: "district", events: [imp({})] })) === "CAL_FORBIDDEN");
ok("後台密碼可以匯入地區行程", (await deskM("cal_desk_import", { adminPassword: "pw", layer: "district", events: [imp({ title: "地區研習" })] })).imported === 1 && T.calendar_events.some((e: any) => e.layer === "district" && e.title === "地區研習" && e.club_name === ""));
ok("匯入：沒資料、超過 300 筆、層級錯誤都被擋", await code(deskM("cal_desk_import", { ...A1, layer: "club", events: [] })) === "BAD_REQUEST" && await code(deskM("cal_desk_import", { ...A1, layer: "club", events: Array.from({ length: 301 }, (_, i) => imp({ row: i })) })) === "CAL_IMPORT_TOO_MANY" && await code(deskM("cal_desk_import", { ...A1, layer: "private", events: [imp({})] })) === "CAL_BAD_LAYER");
T.calendar_events.splice(nEv0);    // 還原，不影響後面的測試

// ---------- 誰可以在 LINE 看全社出席率（後台逐社設定） ----------
const admV = (action: string, extra: any) => handleAdmin(action, { adminPassword: "pw", ...extra }, { admin: db, password: "pw", members: async () => MEMBERS, clubInfos: async () => [{ name: "甲社", division: "第一分區", code: "01-1" }, { name: "乙社", division: "第一分區", code: "01-2" }] });
const zU = { club: "甲社", key: "趙|Z", name: "趙", nickname: "Z" };
const v0 = await admV("cal_admin_viewers_get", { club: "甲社" });
ok("看全社設定：沒設定過＝預設，社長打勾、其他人沒勾，名單照 P→S→Nick Name 排", v0.custom === false && v0.members[0].key === "王|" && v0.members[0].allowed && v0.members[0].isDefault && !v0.members.find((m: any) => m.key === "趙|Z").allowed);
ok("看全社設定：不認得的社被擋、後台密碼錯被擋", await code(admV("cal_admin_viewers_get", { club: "鬼社" })) === "BAD_REQUEST" && await code(handleAdmin("cal_admin_viewers_get", { adminPassword: "x", club: "甲社" }, { admin: db, password: "pw", members: async () => MEMBERS, clubInfos: async () => [] })) === "CAL_ADMIN_AUTH_FAILED");
const v1 = await admV("cal_admin_viewers_save", { club: "甲社", keys: ["趙|Z", "鬼|", "趙|Z"] });
ok("看全社設定：只存社友庫裡的人、不重複；改成只有趙", v1.custom === true && T.calendar_report_viewers.find((r: any) => r.club_name === "甲社").viewers.join() === "趙|Z" && v1.members.find((m: any) => m.key === "趙|Z").allowed && !v1.members.find((m: any) => m.key === "王|").allowed);
ok("設定後：趙在 LINE 可以看全社", (await handleMember("cal_attend_report", { scope: "club", periods: PER }, db, zU, regM)).canClub === true);
ok("設定後：社長沒被勾就不能看全社", await code(handleMember("cal_attend_report", { scope: "club", periods: PER }, db, mkU("王|", "王"), regM)) === "CAL_FORBIDDEN");
ok("別社（乙社）不受甲社設定影響", (await admV("cal_admin_viewers_get", { club: "乙社" })).custom === false);
ok("後台總覽列出有自訂的社與人數", (await adm("cal_admin_state", {})).reportCustomClubs.some((x: any) => x.club === "甲社" && x.count === 1));
await admV("cal_admin_viewers_save", { club: "甲社", keys: ["王|", "趙|Z"] });
ok("再改一次會覆蓋（王、趙）", T.calendar_report_viewers.filter((r: any) => r.club_name === "甲社").length === 1 && T.calendar_report_viewers[0].viewers.length === 2);
const v2 = await admV("cal_admin_viewers_save", { club: "甲社", reset: true });
ok("恢復預設：回到社長可看、趙不能看", v2.custom === false && (await handleMember("cal_attend_report", { scope: "me", periods: PER }, db, zU, regM)).canClub === false && (await handleMember("cal_attend_report", { scope: "me", periods: PER }, db, mkU("王|", "王"), regM)).canClub === true);
// 執秘在報名系統設定自己社（用社密碼）
const dv0 = await deskM("cal_desk_viewers_get", { ...A1, targetClub: "乙社" });
ok("執秘：只能看自己的社（帶別社名稱也只回甲社）", dv0.club === "甲社" && dv0.custom === false);
const dv1 = await deskM("cal_desk_viewers_save", { ...A1, targetClub: "乙社", keys: ["趙|Z", "李|"] });
ok("執秘：儲存只寫自己的社，別社的人不收，記錄是誰設定的", dv1.club === "甲社" && T.calendar_report_viewers.find((r: any) => r.club_name === "甲社").viewers.join() === "趙|Z" && dv1.updatedBy === "報名系統（甲社）" && !T.calendar_report_viewers.some((r: any) => r.club_name === "乙社"));
ok("執秘設定後：趙在 LINE 可以看全社", (await handleMember("cal_attend_report", { scope: "club", periods: PER }, db, zU, regM)).canClub === true);
ok("後台看得到執秘的設定", (await admV("cal_admin_viewers_get", { club: "甲社" })).custom === true);
ok("社密碼錯誤被擋", await code(deskM("cal_desk_viewers_save", { club: "甲社", clubPassword: "x", keys: [] })) === "CLUB_AUTH_FAILED");
await deskM("cal_desk_viewers_save", { ...A1, reset: true });
ok("執秘恢復預設", (await deskM("cal_desk_viewers_get", A1)).custom === false && !T.calendar_report_viewers.some((r: any) => r.club_name === "甲社"));
const dv2 = await deskM("cal_desk_viewers_save", { adminPassword: "pw", targetClub: "乙社", keys: ["李|"] });
ok("後台密碼在報名系統可設定任何一社", dv2.club === "乙社" && dv2.custom === true && dv2.updatedBy === "報名系統（後台）");
ok("後台密碼沒指定社被擋；沒有社友庫的社不寫入", await code(deskM("cal_desk_viewers_get", { adminPassword: "pw" })) === "BAD_REQUEST" && await code(deskM("cal_desk_viewers_save", { adminPassword: "pw", targetClub: "鬼社", keys: [] })) === "CAL_NOT_FOUND");
await deskM("cal_desk_viewers_save", { adminPassword: "pw", targetClub: "乙社", reset: true });
ok("出席率：王 上半年 例會 1/2＋補出席 1 → 100%，純例會 50%", w.sum.h1.held === 2 && w.sum.h1.attended === 1 && w.sum.h1.makeup === 1 && w.sum.h1.rate === 1 && w.sum.h1.meetRate === 0.5);
ok("出席率：全年 例會 1/2＋補出席 2 → 150%（分母固定是本社例會，可以超過 100%）", w.sum.year.makeup === 2 && w.sum.year.district === 2 && w.sum.year.effective === 3 && w.sum.year.rate === 1.5);
ok("出席率：還沒記錄出席的三月例會不列入分母，但列在明細（尚未記錄）", wr.meetings.some((m: any) => m.id === mc.id && m.recorded === false) && wr.periods.find((p: any) => p.id === "h1").held === 2);
ok("出席率：地區活動只算本社、已報到的，並附活動名稱與日期", wr.district.map((d: any) => d.title).sort().join() === "地區研習,地區高球" && w.dist.length === 2);
const dr2 = await deskM("cal_desk_attend_report", { ...A1, periods: PER });
ok("執秘（報名系統）：看得到全社出席率", dr2.club === "甲社" && dr2.people.find((p: any) => p.key === "趙|Z").sum.year.rate === 0.5);
ok("執秘：乙社的密碼只能看乙社", (await deskM("cal_desk_attend_report", { club: "乙社", clubPassword: "b123", targetClub: "甲社", periods: PER })).club === "乙社");
ok("出席率：期間格式錯誤或超過一年被擋", await code(deskM("cal_desk_attend_report", { ...A1, periods: [{ id: "x", from: "2025-01-01", to: "2027-01-01" }] })) === "CAL_BAD_TIME" && await code(deskM("cal_desk_attend_report", { ...A1, periods: [] })) === "CAL_BAD_TIME");

// ---------- 手動登記補出席（友社例會等） ----------
const mk1 = await deskM("cal_desk_makeup_add", { ...A1, person: "趙|Z", date: "2027-03-10", kind: "友社例會", note: "台北東區扶輪社例會" });
ok("登記補出席：只收社友庫裡的人，記錄日期、類別、說明、登記者", mk1.ok && mk1.makeup.key === "趙|Z" && T.calendar_makeups.find((x: any) => x.id === mk1.makeup.id).created_by === "報名系統（甲社）");
await deskM("cal_desk_makeup_add", { ...A1, person: "趙|Z", date: "2027-05-05", kind: "其他", note: "扶青社活動" });
const zr2 = await handleMember("cal_attend_report", { scope: "me", periods: PER }, db, { club: "甲社", key: "趙|Z", name: "趙", nickname: "Z" }, regM);
ok("出席率：趙 上半年 例會 1/2＋友社例會 1 → 100%；全年再加一筆 → 150%", zr2.people[0].sum.h1.manual === 1 && zr2.people[0].sum.h1.rate === 1 && zr2.people[0].sum.year.manual === 2 && zr2.people[0].sum.year.rate === 1.5);
ok("社友本人看得到自己的手動補出席明細（類別、說明）", zr2.manual.length === 2 && zr2.manual.every((x: any) => x.key === "趙|Z") && zr2.manual.some((x: any) => x.note === "台北東區扶輪社例會" && x.kind === "友社例會") && zr2.people[0].mk.length === 2);
const wr2 = await handleMember("cal_attend_report", { scope: "me", periods: PER }, db, mkU("王|", "王"), regM);
ok("別人（王）看自己時看不到趙的補出席", wr2.manual.length === 0);
ok("登記補出席：不在社友庫、日期格式錯、類別不對都被擋", await code(deskM("cal_desk_makeup_add", { ...A1, person: "鬼|", date: "2027-03-10" })) === "CAL_NOT_FOUND" && await code(deskM("cal_desk_makeup_add", { ...A1, person: "趙|Z", date: "3/10" })) === "CAL_BAD_TIME" && await code(deskM("cal_desk_makeup_add", { ...A1, person: "趙|Z", date: "2027-03-10", kind: "亂寫" })) === "BAD_REQUEST");
ok("乙社不能刪甲社的補出席", await code(deskM("cal_desk_makeup_delete", { club: "乙社", clubPassword: "b123", id: mk1.makeup.id })) === "CAL_NOT_FOUND");
await deskM("cal_desk_makeup_delete", { ...A1, id: mk1.makeup.id });
ok("刪除補出席後出席率跟著變", (await deskM("cal_desk_attend_report", { ...A1, periods: PER })).people.find((p: any) => p.key === "趙|Z").sum.h1.rate === 0.5);

// ---------- 總監秘書代管總監的行事曆 ----------
{
  const G: Record<string, any[]> = { calendar_roles: [
    { id: 1, club_name: "甲社", person_key: "總|G", full_name: "總", nickname: "G", role: "governor", managed_club: "" },
    { id: 2, club_name: "甲社", person_key: "秘|S", full_name: "秘", nickname: "S", role: "governor_cc", managed_club: "" },
    { id: 3, club_name: "乙社", person_key: "外|O", full_name: "外", nickname: "O", role: "governor_cc", managed_club: "" },
  ], calendar_events: [
    { id: "gd", layer: "district", club_name: "", owner_key: "", title: "地區大會", start_at: "2026-12-05T01:00:00.000Z", end_at: "2026-12-05T03:00:00.000Z", status: "confirmed" },
    { id: "gc", layer: "club", club_name: "甲社", owner_key: "", title: "甲社例會", start_at: "2026-12-06T01:00:00.000Z", end_at: "2026-12-06T03:00:00.000Z", status: "confirmed" },
    { id: "sc", layer: "club", club_name: "乙社", owner_key: "", title: "乙社例會", start_at: "2026-12-06T01:00:00.000Z", end_at: "2026-12-06T03:00:00.000Z", status: "confirmed" },
    { id: "gp", layer: "private", club_name: "甲社", owner_key: "總|G", title: "總監看醫生", start_at: "2026-12-07T01:00:00.000Z", end_at: "2026-12-07T03:00:00.000Z", status: "confirmed" },
    { id: "sp", layer: "private", club_name: "甲社", owner_key: "秘|S", title: "秘書私事", start_at: "2026-12-07T01:00:00.000Z", end_at: "2026-12-07T03:00:00.000Z", status: "confirmed" },
    { id: "op", layer: "private", club_name: "甲社", owner_key: "王|", title: "王的私事", start_at: "2026-12-07T01:00:00.000Z", end_at: "2026-12-07T03:00:00.000Z", status: "confirmed" },
  ], calendar_event_types: [], calendar_rsvp: [] };
  const g = fake(G);
  const GOV = { club: "甲社", key: "總|G", name: "總", nickname: "G" }, SEC = { club: "甲社", key: "秘|S", name: "秘", nickname: "S" }, X = { club: "甲社", key: "王|", name: "王", nickname: "" };
  const FG = { forGov: { club: "甲社", key: "總|G" } };
  const init = await handleMember("cal_init", {}, g, SEC);
  ok("總監秘書：cal_init 回傳可代管的總監", init.roles.secretary === true && init.roles.govs.length === 1 && init.roles.govs[0].key === "總|G");
  ok("一般社友與總監本人：沒有可代管的對象", !(await handleMember("cal_init", {}, g, X)).roles.govs && !(await handleMember("cal_init", {}, g, GOV)).roles.govs);
  const own = (await handleMember("cal_list", W, g, SEC)).events.map((e: any) => e.title).sort();
  ok("秘書看自己的行事曆：不含總監的私人行程", JSON.stringify(own) === JSON.stringify(["甲社例會", "地區大會", "秘書私事"].sort()));
  const gv = await handleMember("cal_list", { ...W, ...FG }, g, SEC);
  ok("秘書看總監的行事曆：地區＋總監的社＋總監私人（不含秘書自己的、不含別人的私人）", JSON.stringify(gv.events.map((e: any) => e.title).sort()) === JSON.stringify(["地區大會", "甲社例會", "總監看醫生"].sort()));
  ok("總監的行事曆裡只有總監私人行程可以改", gv.events.every((e: any) => e.canEdit === (e.layer === "private")));
  ok("一般社友帶 forGov 被擋", await code(handleMember("cal_list", { ...W, ...FG }, g, X)) === "CAL_FORBIDDEN" && await code(handleMember("cal_save", { event: ev({ layer: "private", title: "亂加" }), ...FG }, g, X)) === "CAL_FORBIDDEN");
  ok("秘書不能代管不是總監的人", await code(handleMember("cal_list", { ...W, forGov: { club: "甲社", key: "王|" } }, g, SEC)) === "CAL_FORBIDDEN");
  const add = await handleMember("cal_save", { event: ev({ layer: "district", title: "拜會市長", rsvpEnabled: true }), ...FG }, g, SEC);
  const row = G.calendar_events.find((e) => e.id === add.event.id);
  ok("秘書代總監新增：一律存成總監名下的私人行程，記錄是秘書代登記", row.layer === "private" && row.club_name === "甲社" && row.owner_key === "總|G" && /總監秘書 秘/.test(row.created_by) && !row.rsvp_enabled);
  ok("總監自己看得到秘書加的行程，而且可以改", (await handleMember("cal_list", W, g, GOV)).events.some((e: any) => e.title === "拜會市長" && e.canEdit));
  const up = await handleMember("cal_save", { event: { ...ev({ title: "總監看牙醫" }), id: "gp" } }, g, SEC);
  ok("秘書可以修改總監自己建的私人行程", up.event.title === "總監看牙醫" && /總監秘書/.test(G.calendar_events.find((e) => e.id === "gp").updated_by));
  ok("秘書可以取消／恢復總監的私人行程", (await handleMember("cal_cancel", { id: "gp" }, g, SEC)).event.status === "cancelled" && (await handleMember("cal_cancel", { id: "gp", cancelled: false }, g, SEC)).event.status === "confirmed");
  ok("秘書不能動別人的私人行程、也不能動地區與社內行程", await code(handleMember("cal_delete", { id: "op" }, g, SEC)) === "CAL_FORBIDDEN" && await code(handleMember("cal_delete", { id: "gd" }, g, SEC)) === "CAL_FORBIDDEN" && await code(handleMember("cal_save", { event: { ...ev({}), id: "gc" } }, g, SEC)) === "CAL_FORBIDDEN");
  ok("總監不能動秘書的私人行程", await code(handleMember("cal_delete", { id: "sp" }, g, GOV)) === "CAL_FORBIDDEN");
  await handleMember("cal_delete", { id: add.event.id }, g, SEC);
  ok("秘書可以刪除總監的私人行程", !G.calendar_events.some((e) => e.id === add.event.id));
  // 與總監同步：秘書在自己的行事曆新增時勾選
  const SG = { shareGov: { club: "甲社", key: "總|G" } };
  const sh = await handleMember("cal_save", { event: ev({ layer: "private", title: "陪同出席授證" }), ...SG }, g, SEC);
  ok("同步新增：只存一筆，在總監名下", G.calendar_events.filter((e) => e.title === "陪同出席授證").length === 1 && G.calendar_events.find((e) => e.id === sh.event.id).owner_key === "總|G" && sh.event.withGov === true);
  const mine = (await handleMember("cal_list", W, g, SEC)).events;
  ok("同步的行程出現在秘書自己的行事曆（標 withGov、可改），總監私事不會出現", mine.some((e: any) => e.title === "陪同出席授證" && e.withGov && e.canEdit) && !mine.some((e: any) => e.title === "總監看牙醫"));
  ok("同步的行程也出現在總監的行事曆", (await handleMember("cal_list", W, g, GOV)).events.some((e: any) => e.title === "陪同出席授證" && e.canEdit));
  await handleMember("cal_save", { event: { ...ev({ title: "陪同出席授證（改時間）" }), id: sh.event.id } }, g, GOV);
  ok("總監改了，秘書那邊跟著變（仍列在秘書的行事曆）", (await handleMember("cal_list", W, g, SEC)).events.some((e: any) => e.title === "陪同出席授證（改時間）" && e.withGov));
  await handleMember("cal_delete", { id: sh.event.id }, g, SEC);
  ok("秘書刪除，兩邊都消失", !(await handleMember("cal_list", W, g, GOV)).events.some((e: any) => e.id === sh.event.id));
  ok("一般社友帶 shareGov 被擋；社內行程帶 shareGov 不會同步", await code(handleMember("cal_save", { event: ev({ layer: "private", title: "亂同步" }), ...SG }, g, X)) === "CAL_FORBIDDEN" && await code(handleMember("cal_save", { event: ev({ layer: "club", club: "乙社" }), ...SG }, g, SEC)) === "CAL_FORBIDDEN");
  const solo = await handleMember("cal_save", { event: ev({ layer: "private", title: "秘書看牙" }) }, g, SEC);
  ok("沒勾同步：存成秘書自己的私人行程，總監看不到", G.calendar_events.find((e) => e.id === solo.event.id).owner_key === "秘|S" && !(await handleMember("cal_list", W, g, GOV)).events.some((e: any) => e.title === "秘書看牙"));
  // 秘書按「我要參加」時同時幫總監登記
  G.calendar_events.find((e) => e.id === "gd").rsvp_enabled = true; G.calendar_events.find((e) => e.id === "gc").rsvp_enabled = true;
  const govJoined = async (id: string) => (await handleMember("cal_list", W, g, GOV)).events.find((e: any) => e.id === id)?.joined || null;
  const st1 = await handleMember("cal_rsvp_status", { id: "gd" }, g, SEC);
  ok("秘書看地區活動：回傳總監的同步狀態（還沒加入）；一般社友沒有這個欄位", st1.gov && st1.gov.joined === false && (await handleMember("cal_rsvp_status", { id: "gd" }, g, X)).gov === null);
  const j1 = await handleMember("cal_rsvp_set", { id: "gd", join: true, withGov: true }, g, SEC);
  ok("秘書參加地區活動並同步：總監也被登記，總監的私人頁（joined）有這筆", j1.mine === "interested" && j1.gov.joined && j1.gov.byMe && (await govJoined("gd")) === "interested");
  await handleMember("cal_rsvp_set", { id: "gd", join: true, withGov: false }, g, SEC);
  ok("取消勾選後更新：收回總監的登記，秘書自己仍參加", (await govJoined("gd")) === null && (await handleMember("cal_rsvp_status", { id: "gd" }, g, SEC)).mine === "interested");
  await handleMember("cal_rsvp_set", { id: "gd", join: true, withGov: true }, g, SEC);
  await handleMember("cal_rsvp_set", { id: "gd", join: false }, g, SEC);
  ok("秘書取消參加：代總監登記的一併取消", (await govJoined("gd")) === null);
  await handleMember("cal_rsvp_set", { id: "gd", join: true }, g, GOV);
  await handleMember("cal_rsvp_set", { id: "gd", join: true, withGov: true }, g, SEC);
  await handleMember("cal_rsvp_set", { id: "gd", join: false }, g, SEC);
  ok("總監自己登記的，秘書取消時不會被收回", (await govJoined("gd")) === "interested");
  await handleMember("cal_rsvp_set", { id: "gd", join: true }, g, X);
  ok("一般社友帶 withGov 沒有作用", G.calendar_rsvp.filter((r) => r.event_id === "gd" && r.person_key === "總|G").length === 1 && !G.calendar_rsvp.some((r) => r.event_id === "gd" && r.person_key === "總|G" && r.proxy_by));
  const j2 = await handleMember("cal_rsvp_set", { id: "gc", join: true, withGov: true }, g, SEC);
  ok("社內活動同步：秘書與總監同社，總監也被登記", j2.gov.joined && j2.gov.byMe && (await govJoined("gc")) === "interested" && !G.calendar_events.some((e) => e.layer === "private" && e.title === "甲社例會"));
  await handleMember("cal_rsvp_set", { id: "gc", join: false }, g, SEC);
  ok("秘書取消社內活動：總監的登記一併取消", (await govJoined("gc")) === null);
  // 秘書在「總監的行事曆」裡看得到總監參加的活動，並可直接幫總監登記／取消
  await handleMember("cal_rsvp_set", { id: "gc", join: true, withGov: true }, g, SEC);
  const gl = (await handleMember("cal_list", { ...W, ...FG }, g, SEC)).events;
  ok("總監的行事曆：同步進來的活動標示總監已參加（秘書看得到）", gl.find((e: any) => e.id === "gc").joined === "interested" && gl.find((e: any) => e.id === "gd").joined === "interested");
  await handleMember("cal_rsvp_set", { id: "gc", join: false }, g, SEC);
  ok("秘書取消後，總監的行事曆上也不再標示參加", (await handleMember("cal_list", { ...W, ...FG }, g, SEC)).events.find((e: any) => e.id === "gc").joined === null);
  const gr1 = await handleMember("cal_gov_rsvp", { id: "gc", join: true, ...FG }, g, SEC);
  ok("在總監行事曆直接幫總監登記：總監參加、秘書自己沒有被登記", gr1.joined === "interested" && (await govJoined("gc")) === "interested" && !G.calendar_rsvp.some((r) => r.event_id === "gc" && r.person_key === "秘|S"));
  ok("在總監行事曆取消總監的參加（含總監自己登記的）", (await handleMember("cal_gov_rsvp", { id: "gc", join: false, ...FG }, g, SEC)).joined === null && (await handleMember("cal_gov_rsvp", { id: "gd", join: false, ...FG }, g, SEC)).joined === null && (await govJoined("gd")) === null);
  ok("一般社友不能幫總監登記；私人行程、沒開放參加的行程不能登記", await code(handleMember("cal_gov_rsvp", { id: "gc", join: true, ...FG }, g, X)) === "CAL_FORBIDDEN" && await code(handleMember("cal_gov_rsvp", { id: "gp", join: true, ...FG }, g, SEC)) === "CAL_NOT_FOUND" && await code(handleMember("cal_gov_rsvp", { id: "sc", join: true, ...FG }, g, SEC)) === "CAL_NOT_FOUND");
  const OUT = { club: "乙社", key: "外|O", name: "外", nickname: "O" };
  ok("不同社的總監秘書：沒有可代管的總監，也不能代管", (await handleMember("cal_init", {}, g, OUT)).roles.govs.length === 0 && await code(handleMember("cal_list", { ...W, ...FG }, g, OUT)) === "CAL_FORBIDDEN");
  {
    const R: Record<string, any[]> = { calendar_roles: [{ id: 1, club_name: "甲社", person_key: "王|", full_name: "王", nickname: "", role: "governor", managed_club: "" }] };
    const ctx = { admin: fake(R), password: "pw", members: async () => ({ 甲社: [{ name: "王", nickname: "" }, { name: "趙", nickname: "" }], 乙社: [{ name: "李", nickname: "" }] }), clubInfos: async () => [] };
    ok("後台：總監秘書與總監不同社不能指定", await code(handleAdmin("cal_admin_grant", { adminPassword: "pw", club: "乙社", personKey: "李|", role: "governor_cc" }, ctx)) === "CAL_GOV_CLUB_MISMATCH");
    ok("後台：同社可以指定為總監秘書", (await handleAdmin("cal_admin_grant", { adminPassword: "pw", club: "甲社", personKey: "趙|", role: "governor_cc" }, ctx)).ok && R.calendar_roles.some((r) => r.role === "governor_cc" && r.club_name === "甲社"));
    ok("後台：已有甲社的秘書時，不能把別社的人指定為總監", await code(handleAdmin("cal_admin_grant", { adminPassword: "pw", club: "乙社", personKey: "李|", role: "governor" }, ctx)) === "CAL_GOV_CLUB_MISMATCH");
  }
  G.calendar_roles = G.calendar_roles.filter((r) => r.role !== "governor_cc");
  const g2 = fake({ ...G, calendar_roles: G.calendar_roles });
  ok("取消秘書身分後立刻不能再看或改", await code(handleMember("cal_list", { ...W, ...FG }, g2, SEC)) === "CAL_FORBIDDEN" && await code(handleMember("cal_delete", { id: "gp" }, g2, SEC)) === "CAL_FORBIDDEN");
}
