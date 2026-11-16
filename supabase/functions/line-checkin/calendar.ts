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

// ---------- 後台動作（電腦版 admin-calendar.html，用後台密碼把關） ----------
export interface AdminCtx { admin: Any; password: string; members: () => Promise<Record<string, Any[]>>; clubNames: () => Promise<string[]> }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const personKey = (p: Any) => `${(p && p.name) || ""}|${(p && p.nickname) || ""}`;

export async function handleAdmin(action: string, body: Any, ctx: AdminCtx): Promise<Any> {
  if (!ctx.password) return fail("CAL_ADMIN_DISABLED");
  if (String(body.adminPassword || "") !== ctx.password) { await sleep(1000); fail("CAL_ADMIN_AUTH_FAILED"); }   // 故意等 1 秒，降低被猜密碼的速度
  const admin = ctx.admin;

  if (action === "cal_admin_state") {
    const { data, error } = await admin.from("calendar_roles").select("*").order("granted_at", { ascending: false });
    if (error) dbFail(error);
    const clubs = await ctx.clubNames();
    const covered = new Set((data || []).filter((r: Any) => r.role === "club_editor").map((r: Any) => r.managed_club));
    return {
      ok: true, types: await loadTypes(admin), clubs,
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
    if (role === "club_editor" && !(await ctx.clubNames()).includes(managedClub)) fail("BAD_REQUEST");
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
