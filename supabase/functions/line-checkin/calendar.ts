// =====================================================================
// 扶輪行事曆（階段 1）的後端邏輯。由 lib.ts 的 handle() 呼叫，動作名稱都以 cal_ 開頭。
//
//  - 社友動作（cal_init / cal_list / cal_save / cal_cancel / cal_delete）：先由 lib.ts 向 LINE 驗證 idToken、
//    查出綁定的社友，這裡再依 calendar_roles 檢查權限。
//  - 後台動作（cal_admin_*）：用 secret CALENDAR_ADMIN_PASSWORD 把關，給電腦版 admin-calendar.html 指派管理者。
//    沒設定這個 secret ＝ 後台功能關閉。
//  - 三張資料表 anon 完全讀不到（見 supabase/sql/calendar.sql），所以私人行程只有這裡能讀。
// =====================================================================
// deno-lint-ignore no-explicit-any
type Any = any;

export class CalError extends Error {
  code: string;
  constructor(code: string) { super(code); this.code = code; }
}
const fail = (code: string): never => { throw new CalError(code); };

export interface CalMe { club: string; key: string; name: string; nickname: string }
export interface CalRoles { district: boolean; clubs: string[]; governor: boolean }

export const LAYERS = ["district", "club", "private"];
const LIMITS: Record<string, number> = { title: 100, location: 200, address: 300, dressCode: 100, contactPerson: 50, contactPhone: 50, notes: 2000 };
const MAX_RANGE_MS = 400 * 86400_000;

const clip = (v: Any, n: number) => String(v == null ? "" : v).trim().slice(0, n);

// 把這位社友的角色資料列整理成好用的樣子
export function rolesOf(rows: Any[]): CalRoles {
  const r: CalRoles = { district: false, clubs: [], governor: false };
  for (const x of rows || []) {
    if (x.role === "district_editor") r.district = true;
    else if (x.role === "governor") r.governor = true;
    else if (x.role === "club_editor" && x.managed_club && !r.clubs.includes(x.managed_club)) r.clubs.push(x.managed_club);
  }
  return r;
}

// 能不能新增／修改／刪除這個行程（權限判斷集中在這裡）
export function canWrite(layer: string, row: { club_name?: string; owner_key?: string }, me: CalMe, roles: CalRoles): boolean {
  if (layer === "district") return roles.district;
  if (layer === "club") return roles.clubs.includes(String(row.club_name || ""));
  if (layer === "private") return row.club_name === me.club && row.owner_key === me.key;
  return false;
}

// 檢查並整理前端送來的行程欄位。回傳可直接寫入資料表的欄位（不含 layer / club_name / owner_key）
export function normalizeEvent(input: Any): Any {
  const e = input || {};
  const title = clip(e.title, LIMITS.title);
  if (!title) fail("CAL_NEED_TITLE");
  const start = Date.parse(String(e.start || ""));
  if (!Number.isFinite(start)) fail("CAL_BAD_TIME");
  let end = e.end ? Date.parse(String(e.end)) : start;
  if (!Number.isFinite(end)) fail("CAL_BAD_TIME");
  if (end < start) fail("CAL_END_BEFORE_START");
  if (end - start > 366 * 86400_000) fail("CAL_BAD_TIME");
  const typeId = Number(e.typeId);
  return {
    title,
    start_at: new Date(start).toISOString(),
    end_at: new Date(end).toISOString(),
    all_day: !!e.allDay,
    event_type_id: Number.isInteger(typeId) && typeId > 0 ? typeId : null,
    location: clip(e.location, LIMITS.location),
    address: clip(e.address, LIMITS.address),
    dress_code: clip(e.dressCode, LIMITS.dressCode),
    contact_person: clip(e.contactPerson, LIMITS.contactPerson),
    contact_phone: clip(e.contactPhone, LIMITS.contactPhone),
    notes: clip(e.notes, LIMITS.notes),
  };
}

function dbFail(error: Any): never {
  const msg = (error && error.message) || String(error || "");
  if (/does not exist|schema cache|could not find|PGRST20[25]|42P01|42883/i.test(msg + " " + ((error && error.code) || ""))) fail("CAL_TABLE_MISSING");
  if (/violates check constraint/i.test(msg)) fail("CAL_BAD_TIME");
  console.error("calendar 資料庫錯誤", msg);
  return fail("SERVER_ERROR");
}

const toView = (r: Any, canEdit: boolean) => ({
  id: r.id, layer: r.layer, club: r.club_name || "", title: r.title,
  start: r.start_at, end: r.end_at, allDay: !!r.all_day, typeId: r.event_type_id,
  location: r.location || "", address: r.address || "", dressCode: r.dress_code || "",
  contactPerson: r.contact_person || "", contactPhone: r.contact_phone || "", notes: r.notes || "",
  status: r.status, updatedAt: r.updated_at, canEdit,
});

async function loadRoles(admin: Any, me: CalMe): Promise<CalRoles> {
  const { data, error } = await admin.from("calendar_roles").select("role,managed_club").eq("club_name", me.club).eq("person_key", me.key);
  if (error) dbFail(error);
  return rolesOf(data || []);
}
async function loadTypes(admin: Any) {
  const { data, error } = await admin.from("calendar_event_types").select("id,name,sort_order").order("sort_order").order("id");
  if (error) dbFail(error);
  return (data || []).map((t: Any) => ({ id: t.id, name: t.name }));
}
const byMe = (me: CalMe) => `${me.name}（${me.club}）`;

// ---------- 社友動作 ----------
export async function handleMember(action: string, body: Any, admin: Any, me: CalMe | null): Promise<Any> {
  if (!me) return fail("NOT_BOUND");
  const roles = await loadRoles(admin, me);

  if (action === "cal_init") {
    return { ok: true, me, roles, types: await loadTypes(admin) };
  }

  if (action === "cal_list") {
    const from = Date.parse(String(body.from || "")), to = Date.parse(String(body.to || ""));
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from || to - from > MAX_RANGE_MS) fail("CAL_BAD_TIME");
    const fromIso = new Date(from).toISOString(), toIso = new Date(to).toISOString();
    // 地區＋本社＋自己的私人，各查一次再合併（不用 or 字串，避免社名裡的符號弄壞查詢）
    const base = () => admin.from("calendar_events").select("*").gte("end_at", fromIso).lte("start_at", toIso).order("start_at").limit(1000);
    const [d, c, p] = await Promise.all([
      base().eq("layer", "district"),
      base().eq("layer", "club").eq("club_name", me.club),
      base().eq("layer", "private").eq("club_name", me.club).eq("owner_key", me.key),
    ]);
    for (const r of [d, c, p]) if (r.error) dbFail(r.error);
    const rows = [...(d.data || []), ...(c.data || []), ...(p.data || [])]
      .sort((a: Any, b: Any) => String(a.start_at).localeCompare(String(b.start_at)));
    return { ok: true, events: rows.map((r: Any) => toView(r, canWrite(r.layer, r, me, roles))) };
  }

  if (action === "cal_save") {
    const input = body.event || {};
    const fields = normalizeEvent(input);
    const id = input.id ? String(input.id) : "";
    if (id) {
      // 修改：層級不能改；只改欄位
      const { data: old, error } = await admin.from("calendar_events").select("*").eq("id", id).maybeSingle();
      if (error) dbFail(error);
      if (!old) fail("CAL_NOT_FOUND");
      if (!canWrite(old.layer, old, me, roles)) fail("CAL_FORBIDDEN");
      const { data, error: e2 } = await admin.from("calendar_events").update({ ...fields, updated_by: byMe(me), updated_at: new Date().toISOString() }).eq("id", id).select().single();
      if (e2) dbFail(e2);
      return { ok: true, event: toView(data, true) };
    }
    const layer = String(input.layer || "");
    if (!LAYERS.includes(layer)) fail("CAL_BAD_LAYER");
    const row: Any = { layer, club_name: "", owner_key: "" };
    if (layer === "club") row.club_name = String(input.club || (roles.clubs.length === 1 ? roles.clubs[0] : ""));
    if (layer === "private") { row.club_name = me.club; row.owner_key = me.key; }
    if (!canWrite(layer, row, me, roles)) fail("CAL_FORBIDDEN");
    const { data, error } = await admin.from("calendar_events").insert({ ...row, ...fields, created_by: byMe(me), updated_by: byMe(me) }).select().single();
    if (error) dbFail(error);
    return { ok: true, event: toView(data, true) };
  }

  // ---------- 訂閱到手機行事曆（.ics）的開關 ----------
  if (action === "cal_ics_status" || action === "cal_ics_set" || action === "cal_ics_rotate") {
    const { data: cur, error } = await admin.from("calendar_ics").select("token,enabled").eq("club_name", me.club).eq("person_key", me.key).maybeSingle();
    if (error) dbFail(error);
    if (action === "cal_ics_status") return { ok: true, enabled: !!(cur && cur.enabled), token: cur && cur.enabled ? cur.token : null };
    const now = new Date().toISOString();
    if (action === "cal_ics_set") {
      const on = body.enabled === true;
      if (!cur) {
        if (!on) return { ok: true, enabled: false, token: null };
        const token = newToken();
        const { error: e1 } = await admin.from("calendar_ics").insert({ club_name: me.club, person_key: me.key, token, enabled: true });
        if (e1) dbFail(e1);
        return { ok: true, enabled: true, token };
      }
      const { error: e2 } = await admin.from("calendar_ics").update({ enabled: on }).eq("club_name", me.club).eq("person_key", me.key);
      if (e2) dbFail(e2);
      return { ok: true, enabled: on, token: on ? cur.token : null };
    }
    // 重新產生：舊網址立即失效；同時視為開啟
    const token = newToken();
    if (!cur) {
      const { error: e3 } = await admin.from("calendar_ics").insert({ club_name: me.club, person_key: me.key, token, enabled: true });
      if (e3) dbFail(e3);
    } else {
      const { error: e4 } = await admin.from("calendar_ics").update({ token, enabled: true, rotated_at: now }).eq("club_name", me.club).eq("person_key", me.key);
      if (e4) dbFail(e4);
    }
    return { ok: true, enabled: true, token };
  }

  if (action === "cal_cancel" || action === "cal_delete") {
    const id = String(body.id || "");
    const { data: old, error } = await admin.from("calendar_events").select("*").eq("id", id).maybeSingle();
    if (error) dbFail(error);
    if (!old) fail("CAL_NOT_FOUND");
    if (!canWrite(old.layer, old, me, roles)) fail("CAL_FORBIDDEN");
    if (action === "cal_delete") {
      const { error: e2 } = await admin.from("calendar_events").delete().eq("id", id);
      if (e2) dbFail(e2);
      return { ok: true };
    }
    // 取消：不刪除，只改狀態；body.cancelled === false 表示恢復
    const status = body.cancelled === false ? "confirmed" : "cancelled";
    const { data, error: e3 } = await admin.from("calendar_events").update({ status, updated_by: byMe(me), updated_at: new Date().toISOString() }).eq("id", id).select().single();
    if (e3) dbFail(e3);
    return { ok: true, event: toView(data, true) };
  }

  return fail("BAD_REQUEST");
}

// ---------- .ics 訂閱內容 ----------
// 隨機長字串（24 位元組＝192 位元），猜不到
export function newToken(): string {
  const b = new Uint8Array(24); crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const icsEsc = (v: Any) => String(v == null ? "" : v).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
// RFC 5545：每行不超過 75 位元組，超過要折行（下一行開頭加一個空白）；以字元為單位切，避免切斷中文
function icsFold(line: string): string {
  const enc = new TextEncoder(); const out: string[] = []; let cur = "", bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > (out.length ? 74 : 75)) { out.push(cur); cur = ""; bytes = 0; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}
const icsUtc = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsDate = (iso: string) => { const d = new Date(Date.parse(iso) + 8 * 3600e3); return d.toISOString().slice(0, 10).replace(/-/g, ""); };   // 台灣日期

export function buildIcs(events: Any[], types: Record<string, string>, calName: string): string {
  const L: string[] = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Rotary//Calendar//ZH-TW", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEsc(calName)}`, "X-WR-TIMEZONE:Asia/Taipei", "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H"];
  const layerName: Record<string, string> = { district: "地區", club: "社內", private: "私人" };
  for (const e of events) {
    const desc: string[] = [];
    const t = e.event_type_id != null ? types[String(e.event_type_id)] : "";
    desc.push(`【${layerName[e.layer] || ""}${t ? "・" + t : ""}】`);
    if (e.dress_code) desc.push(`服裝：${e.dress_code}`);
    if (e.contact_person || e.contact_phone) desc.push(`聯絡：${[e.contact_person, e.contact_phone].filter(Boolean).join(" ")}`);
    if (e.address) desc.push(`地址：${e.address}`);
    if (e.notes) desc.push(e.notes);
    L.push("BEGIN:VEVENT", `UID:${e.id}@rotary-calendar`, `DTSTAMP:${icsUtc(e.updated_at || e.created_at || new Date().toISOString())}`);
    if (e.all_day) {
      const endDay = icsDate(new Date(Date.parse(e.end_at) + 86400e3).toISOString());   // DTEND 為「不含」的日期，要加一天
      L.push(`DTSTART;VALUE=DATE:${icsDate(e.start_at)}`, `DTEND;VALUE=DATE:${endDay}`);
    } else {
      const end = Date.parse(e.end_at) > Date.parse(e.start_at) ? e.end_at : new Date(Date.parse(e.start_at) + 3600e3).toISOString();
      L.push(`DTSTART:${icsUtc(e.start_at)}`, `DTEND:${icsUtc(end)}`);
    }
    L.push(`SUMMARY:${icsEsc((e.status === "cancelled" ? "【已取消】" : "") + e.title)}`);
    if (e.location || e.address) L.push(`LOCATION:${icsEsc(e.location || e.address)}`);
    L.push(`DESCRIPTION:${icsEsc(desc.join("\n"))}`, `STATUS:${e.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`, "END:VEVENT");
  }
  L.push("END:VCALENDAR");
  return L.map(icsFold).join("\r\n") + "\r\n";
}

// 用 token 產生訂閱內容；token 不存在或已關閉回 null。範圍：今天前 30 天 ～ 未來 365 天，
// 內容＝地區＋該社友所屬社的社內＋他自己的私人行程（與他在 LINE 看到的「所有行程」相同）。
export async function icsFeed(admin: Any, token: string): Promise<string | null> {
  if (!token || token.length < 20) return null;
  const { data: row, error } = await admin.from("calendar_ics").select("club_name,person_key,enabled").eq("token", token).maybeSingle();
  if (error) dbFail(error);
  if (!row || !row.enabled) return null;
  const from = new Date(Date.now() - 30 * 86400e3).toISOString(), to = new Date(Date.now() + 365 * 86400e3).toISOString();
  const base = () => admin.from("calendar_events").select("*").gte("end_at", from).lte("start_at", to).order("start_at").limit(2000);
  const [d, c, p] = await Promise.all([
    base().eq("layer", "district"),
    base().eq("layer", "club").eq("club_name", row.club_name),
    base().eq("layer", "private").eq("club_name", row.club_name).eq("owner_key", row.person_key),
  ]);
  for (const r of [d, c, p]) if (r.error) dbFail(r.error);
  const types: Record<string, string> = {};
  for (const t of await loadTypes(admin)) types[String(t.id)] = t.name;
  return buildIcs([...(d.data || []), ...(c.data || []), ...(p.data || [])], types, "扶輪行事曆");
}

// ---------- 後台動作（電腦版 admin-calendar.html，用後台密碼把關） ----------
export interface AdminCtx { admin: Any; password: string; members: () => Promise<Record<string, Any[]>>; clubInfos: () => Promise<{ name: string; division: string; code: string }[]> }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const personKey = (p: Any) => `${(p && p.name) || ""}|${(p && p.nickname) || ""}`;

export async function handleAdmin(action: string, body: Any, ctx: AdminCtx): Promise<Any> {
  if (!ctx.password) return fail("CAL_ADMIN_DISABLED");
  if (String(body.adminPassword || "") !== ctx.password) { await sleep(1000); fail("CAL_ADMIN_AUTH_FAILED"); }   // 故意等 1 秒，降低被猜密碼的速度
  const admin = ctx.admin;

  if (action === "cal_admin_state") {
    const { data, error } = await admin.from("calendar_roles").select("*").order("granted_at", { ascending: false });
    if (error) dbFail(error);
    const clubInfos = await ctx.clubInfos();      // 依分區排序的社清單（含分區名稱與社代號）
    const clubs = clubInfos.map((c) => c.name);
    const covered = new Set((data || []).filter((r: Any) => r.role === "club_editor").map((r: Any) => r.managed_club));
    return {
      ok: true, types: await loadTypes(admin), clubs, clubInfos,
      roles: (data || []).map((r: Any) => ({ id: r.id, club: r.club_name, name: r.full_name, nickname: r.nickname, role: r.role, managedClub: r.managed_club })),
      clubsWithoutEditor: clubs.filter((c) => !covered.has(c)),
    };
  }

  if (action === "cal_admin_members") {
    const q = String(body.q || "").trim().toLowerCase();
    if (q.length < 1) return { ok: true, members: [] };
    const all = await ctx.members();
    const out: Any[] = [];
    for (const club of Object.keys(all)) {
      for (const m of Array.isArray(all[club]) ? all[club] : []) {
        if (!m || !m.name) continue;
        if ((club + " " + m.name + " " + (m.nickname || "")).toLowerCase().includes(q)) out.push({ club, key: personKey(m), name: m.name, nickname: m.nickname || "", role: m.role || "" });
        if (out.length >= 30) return { ok: true, members: out };
      }
    }
    return { ok: true, members: out };
  }

  if (action === "cal_admin_grant") {
    const club = String(body.club || ""), key = String(body.personKey || ""), role = String(body.role || "");
    if (!["district_editor", "club_editor", "governor"].includes(role)) fail("BAD_REQUEST");
    const list = (await ctx.members())[club];
    const m = (Array.isArray(list) ? list : []).find((x: Any) => x && x.name && personKey(x) === key);
    if (!m) fail("MEMBER_NOT_FOUND");
    const managedClub = role === "club_editor" ? String(body.managedClub || club) : "";
    if (role === "club_editor" && !(await ctx.clubInfos()).some((c) => c.name === managedClub)) fail("BAD_REQUEST");
    const { error } = await admin.from("calendar_roles").upsert(
      { club_name: club, person_key: key, full_name: m.name, nickname: m.nickname || "", role, managed_club: managedClub },
      { onConflict: "club_name,person_key,role,managed_club", ignoreDuplicates: true });
    if (error) dbFail(error);
    return { ok: true };
  }

  if (action === "cal_admin_revoke") {
    const { error } = await admin.from("calendar_roles").delete().eq("id", Number(body.id));
    if (error) dbFail(error);
    return { ok: true };
  }

  if (action === "cal_admin_type_save") {
    const name = clip(body.name, 30);
    if (!name) fail("CAL_NEED_TITLE");
    if (body.id) {
      const { error } = await admin.from("calendar_event_types").update({ name }).eq("id", Number(body.id));
      if (error) dbFail(error);
    } else {
      const { data: last } = await admin.from("calendar_event_types").select("sort_order").order("sort_order", { ascending: false }).limit(1);
      const { error } = await admin.from("calendar_event_types").insert({ name, sort_order: ((last && last[0] && last[0].sort_order) || 0) + 10 });
      if (error) dbFail(error);
    }
    return { ok: true, types: await loadTypes(admin) };
  }

  if (action === "cal_admin_type_delete") {
    const { error } = await admin.from("calendar_event_types").delete().eq("id", Number(body.id));   // 已使用的行程會變成「未分類」
    if (error) dbFail(error);
    return { ok: true, types: await loadTypes(admin) };
  }

  return fail("BAD_REQUEST");
}
