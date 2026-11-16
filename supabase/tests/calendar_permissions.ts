import { handleMember, handleAdmin, icsFeed, buildIcs } from "../functions/line-checkin/calendar.ts";
// 極簡假資料庫：支援 select/insert/update/delete/upsert + eq/gte/lte/order/limit/maybeSingle/single
function fake(tables: Record<string, any[]>) {
  let seq = 1000;
  return { from(t: string) {
    tables[t] ||= []; const f: any[] = []; let op = "select", payload: any = null, one = "";
    const run = () => {
      const m = (r: any) => f.every((x) => x(r));
      if (op === "insert") { const r = { id: t === "calendar_events" ? "ev" + (seq++) : seq++, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), status: "confirmed", ...payload }; tables[t].push(r); return [r]; }
      if (op === "upsert") { const dup = tables[t].find((r) => ["club_name","person_key","role","managed_club"].every((k) => r[k] === payload[k])); if (!dup) tables[t].push({ id: seq++, granted_at: "x", ...payload }); return []; }
      if (op === "update") { const rs = tables[t].filter(m); rs.forEach((r) => Object.assign(r, payload)); return rs; }
      if (op === "delete") { const keep = tables[t].filter((r) => !m(r)); tables[t].length = 0; tables[t].push(...keep); return []; }
      return tables[t].filter(m);
    };
    const b: any = {
      select() { return b; }, insert(p: any) { op = "insert"; payload = p; return b; }, update(p: any) { op = "update"; payload = p; return b; },
      upsert(p: any) { op = "upsert"; payload = p; return b; }, delete() { op = "delete"; return b; },
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
const adm = (action: string, extra: any) => handleAdmin(action, { adminPassword: "pw", ...extra }, { admin: db, password: "pw", members: async () => ({ 甲社: [{ name: "王", nickname: "" }], 乙社: [{ name: "李", nickname: "" }] }), clubNames: async () => ["甲社", "乙社"] });
ok("後台密碼錯誤被擋", await code(handleAdmin("cal_admin_state", { adminPassword: "x" }, { admin: db, password: "pw", members: async () => ({}), clubNames: async () => [] })) === "CAL_ADMIN_AUTH_FAILED");
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
