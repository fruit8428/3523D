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
  const out: Any = {
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
  if (e.registrationKey !== undefined) out.registration_key = clip(e.registrationKey, 200) || null;
  if (e.rsvpEnabled !== undefined) out.rsvp_enabled = !!e.rsvpEnabled;                             // 開放社友按「我要參加」   // 對應報名系統的「大類id::子活動名稱」
  return out;
}

function dbFail(error: Any): never {
  const msg = (error && error.message) || String(error || "");
  if (/does not exist|schema cache|could not find|PGRST20[25]|42P01|42883/i.test(msg + " " + ((error && error.code) || ""))) fail("CAL_TABLE_MISSING");
  if (/violates check constraint/i.test(msg)) fail("CAL_BAD_TIME");
  console.error("calendar 資料庫錯誤", msg);
  return fail("SERVER_ERROR");
}

const toView = (r: Any, canEdit: boolean, joined: string | null = null) => ({
  id: r.id, layer: r.layer, club: r.club_name || "", title: r.title,
  start: r.start_at, end: r.end_at, allDay: !!r.all_day, typeId: r.event_type_id,
  location: r.location || "", address: r.address || "", dressCode: r.dress_code || "",
  contactPerson: r.contact_person || "", contactPhone: r.contact_phone || "", notes: r.notes || "",
  status: r.status, updatedAt: r.updated_at, canEdit, registrationKey: r.registration_key || "", rsvpEnabled: !!r.rsvp_enabled,
  joined,      // 我參加的活動：'registered'＝執秘已送出正式報名、'interested'＝我按了「我要參加」、null＝沒參加（私人行事曆會顯示 registered／interested 的活動）
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- 社友動作 ----------
// 報名系統的名單（由 lib.ts 以 CheckinCore.buildRoster 算出，與報到、推播同一套算法）
export interface RegDeps {
  roster: (eventKey: string) => Promise<{ ok: boolean; title: string; persons: Any[] }>;
  // 這位社友的「家人」（社友庫裡互為寶尊眷的人）。每個社的社友庫都在同一包資料裡，比較大，所以只有需要時才讀（自動更新時不讀）
  family?: (club: string, personKey: string, name: string) => Promise<{ key: string; name: string; nickname: string; role: string }[]>;
}

// 目前這個行程裡「我們社」有哪些人報名／表示參加
async function rsvpStatus(admin: Any, ev: Any, me: CalMe, reg: RegDeps | undefined, withFamily = false) {
  const key = String(ev.registration_key || "");
  let roster: { ok: boolean; title: string; persons: Any[] } = { ok: false, title: "", persons: [] };
  if (key && reg) roster = await reg.roster(key);
  // 可以按「我要參加」的條件：有對應到報名系統的活動，或行程本身開放參加（社內例會等不需要報名的活動）
  if (!roster.ok && !ev.rsvp_enabled) return { linked: false };
  const formal = roster.ok ? roster.persons.filter((p: Any) => p.club === me.club) : [];
  const { data, error } = await admin.from("calendar_rsvp").select("person_key,full_name,nickname,guest_of,guest_role,proxy_by,created_at").eq("event_id", ev.id).eq("club_name", me.club).order("created_at");
  if (error) dbFail(error);
  const formalKeys = new Set(formal.map((p: Any) => p.key));
  const people = [
    ...formal.map((p: Any) => ({ key: p.key, name: p.name || p.nickname, nickname: p.name ? p.nickname : "", status: "registered", guestOf: "", role: p.role || "" })),
    ...(data || []).filter((r: Any) => !formalKeys.has(r.person_key)).map((r: Any) => ({ key: r.person_key, name: r.full_name, nickname: r.nickname || "", status: "interested", guestOf: r.guest_of || "", role: r.guest_role || "", proxy: !!r.proxy_by })),
  ];
  const mine = people.find((p) => p.key === me.key) || people.find((p) => p.name === me.name && formal.some((f: Any) => f.name === me.name));
  const out: Any = {
    linked: true, title: roster.title || ev.title, open: ev.status !== "cancelled", mine: mine ? mine.status : null, people,
    registeredCount: formal.length, interestedCount: people.length - formal.length,
    myGuests: (data || []).filter((r: Any) => r.guest_of === me.key).map((r: Any) => r.person_key),    // 我已經幫哪些寶尊眷登記
  };
  // listed＝已經在名單上、但不是我帶的（例如執秘代為登記）：前端顯示「已登記」，不能再勾
  const listedKeys = new Set<string>((data || []).filter((r: Any) => r.guest_of !== me.key).map((r: Any) => r.person_key));
  if (withFamily && reg && reg.family) out.family = (await reg.family(me.club, me.key, me.name)).map((f) => ({ ...f, registered: formalKeys.has(f.key), listed: !formalKeys.has(f.key) && listedKeys.has(f.key) }));
  return out;
}

// 這批行程裡「我參加的」：地區／社內行程中，我已被執秘正式報名（名單算法與報到、推播相同），或我按了「我要參加」。
// 結果用來讓這些活動也出現在「私人」行事曆。報名名單每個對應活動只算一次。
async function joinedMap(admin: Any, rows: Any[], me: CalMe, reg: RegDeps | undefined): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const shared = rows.filter((r: Any) => r.layer !== "private");
  if (!shared.length) return out;
  const { data, error } = await admin.from("calendar_rsvp").select("event_id").eq("club_name", me.club).eq("person_key", me.key).in("event_id", shared.map((r: Any) => r.id));
  if (error) dbFail(error);
  for (const x of data || []) out.set(x.event_id, "interested");
  if (reg) {
    const formal = new Map<string, boolean>();
    for (const key of new Set<string>(shared.map((r: Any) => String(r.registration_key || "")).filter(Boolean))) {
      const roster = await reg.roster(key);
      formal.set(key, !!roster.ok && roster.persons.some((p: Any) => p.club === me.club && (p.key === me.key || p.name === me.name)));
    }
    for (const r of shared) if (r.registration_key && formal.get(String(r.registration_key))) out.set(r.id, "registered");     // 正式報名優先於意願
  }
  return out;
}

export async function handleMember(action: string, body: Any, admin: Any, me: CalMe | null, reg?: RegDeps): Promise<Any> {
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
    const joined = await joinedMap(admin, rows, me, reg);
    return { ok: true, events: rows.map((r: Any) => toView(r, canWrite(r.layer, r, me, roles), joined.get(r.id) || null)) };
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
      if (old.layer === "private") { delete fields.registration_key; delete fields.rsvp_enabled; }      // 私人行程不能對應報名或開放參加
      const { data, error: e2 } = await admin.from("calendar_events").update({ ...fields, updated_by: byMe(me), updated_at: new Date().toISOString() }).eq("id", id).select().single();
      if (e2) dbFail(e2);
      return { ok: true, event: toView(data, true) };
    }
    const layer = String(input.layer || "");
    if (!LAYERS.includes(layer)) fail("CAL_BAD_LAYER");
    const row: Any = { layer, club_name: "", owner_key: "" };
    if (layer === "private") { delete fields.registration_key; delete fields.rsvp_enabled; }
    if (layer === "club") row.club_name = String(input.club || (roles.clubs.length === 1 ? roles.clubs[0] : ""));
    if (layer === "private") { row.club_name = me.club; row.owner_key = me.key; }
    if (!canWrite(layer, row, me, roles)) fail("CAL_FORBIDDEN");
    const { data, error } = await admin.from("calendar_events").insert({ ...row, ...fields, created_by: byMe(me), updated_by: byMe(me) }).select().single();
    if (error) dbFail(error);
    return { ok: true, event: toView(data, true) };
  }

  // ---------- 社內已報名名單、我要參加 ----------
  if (action === "cal_rsvp_status" || action === "cal_rsvp_set") {
    const { data: ev, error } = await admin.from("calendar_events").select("*").eq("id", String(body.id || "")).maybeSingle();
    if (error) dbFail(error);
    // 只有「看得到的」行程才查得到：地區行程，或本社的社內行程（私人行程沒有報名）
    if (!ev || ev.layer === "private" || (ev.layer === "club" && ev.club_name !== me.club)) fail("CAL_NOT_FOUND");
    if (action === "cal_rsvp_status") {
      // 自動更新（poll）時不需要家人名單，省掉讀取整包社友庫
      return { ok: true, ...(await rsvpStatus(admin, ev, me, reg, body.poll !== true)) };
    }
    const st0: Any = await rsvpStatus(admin, ev, me, reg, true);
    if (!st0.linked) fail("CAL_REG_UNAVAILABLE");
    const rsvpTable = () => admin.from("calendar_rsvp");
    if (body.join === true) {
      if (ev.status === "cancelled") fail("CAL_EVENT_CANCELLED");
      if (!st0.mine) {
        const { error: e1 } = await rsvpTable().upsert(
          { event_id: ev.id, club_name: me.club, person_key: me.key, full_name: me.name, nickname: me.nickname || "" },
          { onConflict: "event_id,club_name,person_key", ignoreDuplicates: true });
        if (e1) dbFail(e1);
      }
      // 寶尊眷：只接受社友庫裡「我的家人」；前端送來的其他人一律忽略。這裡的結果＝「我帶的寶尊眷」就是勾選的那些
      const family = new Map<string, Any>((st0.family || []).map((f: Any) => [f.key, f]));
      const wanted = [...new Set<string>((Array.isArray(body.guestKeys) ? body.guestKeys : []).map(String))].filter((k) => family.has(k) && k !== me.key);
      const had: string[] = st0.myGuests || [];
      const drop = had.filter((k) => !wanted.includes(k));
      if (drop.length) {
        const { error: e2 } = await rsvpTable().delete().eq("event_id", ev.id).eq("club_name", me.club).eq("guest_of", me.key).in("person_key", drop);
        if (e2) dbFail(e2);
      }
      const taken = new Set<string>((st0.people || []).map((p: Any) => p.key));       // 已經登記過（含執秘已正式報名）的人不重複登記
      for (const k of wanted.filter((k) => !had.includes(k) && !taken.has(k))) {
        const f = family.get(k);
        const { error: e3 } = await rsvpTable().upsert(
          { event_id: ev.id, club_name: me.club, person_key: k, full_name: f.name, nickname: f.nickname || "", guest_of: me.key, guest_role: f.role || "" },
          { onConflict: "event_id,club_name,person_key", ignoreDuplicates: true });
        if (e3) dbFail(e3);
      }
    } else {
      if (st0.mine === "registered") fail("CAL_RSVP_LOCKED");       // 已由執秘送出正式報名，要取消請洽執秘
      const { error: e4 } = await rsvpTable().delete().eq("event_id", ev.id).eq("club_name", me.club).eq("person_key", me.key);
      if (e4) dbFail(e4);
      const { error: e5 } = await rsvpTable().delete().eq("event_id", ev.id).eq("club_name", me.club).eq("guest_of", me.key);   // 我帶的寶尊眷一併取消
      if (e5) dbFail(e5);
    }
    return { ok: true, ...(await rsvpStatus(admin, ev, me, reg, true)) };
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

// ---------- 報名系統裡的「行事曆管理」（電腦版，不需 LINE） ----------
// 認證二擇一：
//   adminPassword            ＝行事曆後台密碼 → 可管理地區行程，以及任何一社的社內行程
//   club + clubPassword      ＝社的登入密碼（與 LINE 綁定名單同一做法）→ 只能管理「自己那一社」的社內行程
// 私人行程一律不開放（只有本人在 LINE 裡看得到）。
export interface DeskCtx {
  admin: Any; password: string;
  checkClub: (club: string, password: string) => Promise<void>;
  roster?: RegDeps["roster"];                                        // 報名活動資料（確認這個活動存在、取得名稱）
  isChair?: (club: string, eventKey: string) => Promise<boolean>;     // 這一社是不是該活動的主委
  members?: (club: string) => Promise<Any[]>;                         // 該社的社友庫（記錄實際出席時用來確認名單）
}
// 由「主委活動設定」自動建立的行程，用這個標記辨識（只有這種行程會被自動更新／移除，手動建立的不會被動到）
export const AUTO_SYNC_MARK = "主委活動設定（自動連動）";

export async function handleDesk(action: string, body: Any, ctx: DeskCtx): Promise<Any> {
  const admin = ctx.admin;
  let isAdmin = false, club = "";
  if (String(body.adminPassword || "")) {
    if (!ctx.password) fail("CAL_ADMIN_DISABLED");
    if (String(body.adminPassword) !== ctx.password) { await sleep(1000); fail("CAL_ADMIN_AUTH_FAILED"); }
    isAdmin = true;
  } else {
    club = String(body.club || "");
    await ctx.checkClub(club, String(body.clubPassword || ""));   // 失敗會丟出 CLUB_AUTH_FAILED
  }
  const can = (layer: string, rowClub: string) => layer === "district" ? isAdmin : layer === "club" ? (isAdmin || (!!club && rowClub === club)) : false;
  const by = isAdmin ? "報名系統（後台）" : `報名系統（${club}）`;

  if (action === "cal_desk_list") {
    const layer = String(body.layer || "");
    const target = layer === "club" ? String(body.targetClub || club) : "";
    if (layer !== "district" && layer !== "club") fail("CAL_BAD_LAYER");
    if (!can(layer, target)) fail("CAL_FORBIDDEN");
    const from = Date.parse(String(body.from || "")), to = Date.parse(String(body.to || ""));
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from || to - from > MAX_RANGE_MS) fail("CAL_BAD_TIME");
    let q = admin.from("calendar_events").select("*").eq("layer", layer).gte("end_at", new Date(from).toISOString()).lte("start_at", new Date(to).toISOString()).order("start_at").limit(1000);
    if (layer === "club") q = q.eq("club_name", target);
    const { data, error } = await q;
    if (error) dbFail(error);
    const counts = new Map<string, number>();
    if ((data || []).length) {
      const { data: rs, error: e1 } = await admin.from("calendar_rsvp").select("event_id").in("event_id", (data || []).map((r: Any) => r.id));
      if (e1) dbFail(e1);
      for (const x of rs || []) counts.set(x.event_id, (counts.get(x.event_id) || 0) + 1);
    }
    return { ok: true, events: (data || []).map((r: Any) => ({ ...toView(r, true), rsvpCount: counts.get(r.id) || 0 })), types: await loadTypes(admin) };
  }

  // ---------- 社內例會：實際出席紀錄 ----------
  // 只限社內行程（地區活動的出席請用報到系統）。讀取：回傳已記錄的出席者與「表示參加」名單；
  // 儲存：body.keys＝實際出席者的 person_key（社友庫裡的人，含寶尊眷），整批取代這個行程的出席紀錄。
  if (action === "cal_desk_attend_get" || action === "cal_desk_attend_save") {
    const { data: ev, error } = await admin.from("calendar_events").select("*").eq("id", String(body.id || "")).maybeSingle();
    if (error) dbFail(error);
    if (!ev || ev.layer !== "club") fail("CAL_NOT_FOUND");
    if (!can("club", ev.club_name)) fail("CAL_FORBIDDEN");
    if (action === "cal_desk_attend_save") {
      const list: Any[] = ctx.members ? await ctx.members(ev.club_name) : [];
      const byKey = new Map<string, Any>(list.filter((m: Any) => m && m.name).map((m: Any) => [personKey(m), m]));
      const keys = [...new Set<string>((Array.isArray(body.keys) ? body.keys : []).map(String))].filter((k) => byKey.has(k));   // 只接受社友庫裡的人
      const { error: e1 } = await admin.from("calendar_attendance").delete().eq("event_id", ev.id).eq("club_name", ev.club_name);
      if (e1) dbFail(e1);
      if (keys.length) {
        const rows = keys.map((k) => { const m = byKey.get(k); const guest = !!m.spouseOfId || /眷/.test(String(m.role || "")); return { event_id: ev.id, club_name: ev.club_name, person_key: k, full_name: m.name, nickname: m.nickname || "", role: m.role || "", is_guest: guest, marked_by: by }; });
        const { error: e2 } = await admin.from("calendar_attendance").insert(rows);
        if (e2) dbFail(e2);
      }
    }
    const [a, r] = await Promise.all([
      admin.from("calendar_attendance").select("person_key").eq("event_id", ev.id).eq("club_name", ev.club_name),
      admin.from("calendar_rsvp").select("person_key,full_name,nickname,guest_of,guest_role,proxy_by").eq("event_id", ev.id).eq("club_name", ev.club_name),
    ]);
    if (a.error) dbFail(a.error);
    if (r.error) dbFail(r.error);
    return { ok: true, title: ev.title, start: ev.start_at, club: ev.club_name, attended: (a.data || []).map((x: Any) => x.person_key), recorded: (a.data || []).length > 0, rsvp: (r.data || []).map((x: Any) => ({ key: x.person_key, name: x.full_name, nickname: x.nickname || "", guest: rsvpIsGuest(x), proxy: !!x.proxy_by })) };
  }

  // ---------- 執秘代為登記參加（不會用 LINE 的長輩等） ----------
  // 只限社內行程，且行程要「開放參加」或有對應報名活動。讀取：目前名單（誰是社友自己登記、誰是執秘代登記）；
  // 儲存：body.keys＝「執秘代登記」的人（社友庫裡的人），只增刪執秘代登記的那些列；社友自己在 LINE 登記的不動。
  if (action === "cal_desk_proxy_get" || action === "cal_desk_proxy_save") {
    const { data: ev, error } = await admin.from("calendar_events").select("*").eq("id", String(body.id || "")).maybeSingle();
    if (error) dbFail(error);
    if (!ev || ev.layer !== "club") fail("CAL_NOT_FOUND");
    if (!can("club", ev.club_name)) fail("CAL_FORBIDDEN");
    if (!ev.rsvp_enabled && !ev.registration_key) fail("CAL_REG_UNAVAILABLE");
    const rsvpTable = () => admin.from("calendar_rsvp");
    if (action === "cal_desk_proxy_save") {
      if (ev.status === "cancelled") fail("CAL_EVENT_CANCELLED");
      const list: Any[] = ctx.members ? await ctx.members(ev.club_name) : [];
      const byKey = new Map<string, Any>(list.filter((m: Any) => m && m.name).map((m: Any) => [personKey(m), m]));
      const wanted = [...new Set<string>((Array.isArray(body.keys) ? body.keys : []).map(String))].filter((k) => byKey.has(k));   // 只接受社友庫裡的人
      const { data: cur, error: e0 } = await rsvpTable().select("person_key,proxy_by").eq("event_id", ev.id).eq("club_name", ev.club_name);
      if (e0) dbFail(e0);
      const proxied = (cur || []).filter((r: Any) => r.proxy_by).map((r: Any) => r.person_key);
      const present = new Set<string>((cur || []).map((r: Any) => r.person_key));
      const drop = proxied.filter((k: string) => !wanted.includes(k));
      if (drop.length) {
        const { error: e1 } = await rsvpTable().delete().eq("event_id", ev.id).eq("club_name", ev.club_name).in("person_key", drop);
        if (e1) dbFail(e1);
      }
      const add = wanted.filter((k) => !present.has(k)).map((k) => {
        const m = byKey.get(k), guest = !!m.spouseOfId || /眷/.test(String(m.role || ""));
        return { event_id: ev.id, club_name: ev.club_name, person_key: k, full_name: m.name, nickname: m.nickname || "", guest_of: "", guest_role: guest ? (m.role || "寶(尊)眷") : "", proxy_by: by };
      });
      for (const row of add) {
        const { error: e2 } = await rsvpTable().upsert(row, { onConflict: "event_id,club_name,person_key", ignoreDuplicates: true });
        if (e2) dbFail(e2);
      }
    }
    const { data, error: e3 } = await rsvpTable().select("person_key,full_name,nickname,guest_of,guest_role,proxy_by").eq("event_id", ev.id).eq("club_name", ev.club_name).order("created_at");
    if (e3) dbFail(e3);
    return { ok: true, title: ev.title, start: ev.start_at, club: ev.club_name, cancelled: ev.status === "cancelled",
      people: (data || []).map((r: Any) => ({ key: r.person_key, name: r.full_name, nickname: r.nickname || "", guest: rsvpIsGuest(r), proxy: !!r.proxy_by })) };
  }

  // ---------- 社內例會統計（某段期間） ----------
  // 回傳期間內本社的社內行程（開放參加、或有人表示參加、或已記錄出席；已取消的不算），每場的「表示參加」與「實際出席」名單，
  // 由前端彙整成「每位社友的參加次數」與 Excel。
  if (action === "cal_desk_stats") {
    const target = isAdmin ? String(body.targetClub || "") : club;
    if (!target) fail("BAD_REQUEST");
    const from = Date.parse(String(body.from || "")), to = Date.parse(String(body.to || ""));
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from || to - from > MAX_RANGE_MS) fail("CAL_BAD_TIME");
    const { data: evs, error } = await admin.from("calendar_events").select("*").eq("layer", "club").eq("club_name", target)
      .gte("end_at", new Date(from).toISOString()).lte("start_at", new Date(to).toISOString()).order("start_at").limit(1000);
    if (error) dbFail(error);
    const live = (evs || []).filter((e: Any) => e.status !== "cancelled");
    const ids = live.map((e: Any) => e.id);
    let rs: Any[] = [], at: Any[] = [];
    if (ids.length) {
      const [r1, r2] = await Promise.all([
        admin.from("calendar_rsvp").select("event_id,person_key,full_name,nickname,guest_of,guest_role").in("event_id", ids).eq("club_name", target),
        admin.from("calendar_attendance").select("event_id,person_key,full_name,nickname,role,is_guest").in("event_id", ids).eq("club_name", target),
      ]);
      if (r1.error) dbFail(r1.error);
      if (r2.error) dbFail(r2.error);
      rs = r1.data || []; at = r2.data || [];
    }
    const people: Record<string, Any> = {};
    for (const x of rs) people[x.person_key] = people[x.person_key] || { name: x.full_name, nickname: x.nickname || "", role: x.guest_role || "", guest: rsvpIsGuest(x) };
    for (const x of at) people[x.person_key] = { name: x.full_name, nickname: x.nickname || "", role: x.role || "", guest: !!x.is_guest };
    const events = live.map((e: Any) => {
      const rsvp = rs.filter((x) => x.event_id === e.id).map((x) => x.person_key);
      const attended = at.filter((x) => x.event_id === e.id).map((x) => x.person_key);
      return { id: e.id, title: e.title, start: e.start_at, end: e.end_at, allDay: !!e.all_day, rsvpEnabled: !!e.rsvp_enabled, typeId: e.event_type_id, rsvp, attended, recorded: attended.length > 0 };
    }).filter((e: Any) => e.rsvpEnabled || e.rsvp.length || e.attended.length);
    return { ok: true, club: target, events, people, types: await loadTypes(admin) };
  }

  // 某個行程目前有誰表示要參加（含寶尊眷）。社內行程只有該社；地區行程是各社合併（只有後台密碼可看）
  if (action === "cal_desk_event_rsvp") {
    const { data: ev, error } = await admin.from("calendar_events").select("*").eq("id", String(body.id || "")).maybeSingle();
    if (error) dbFail(error);
    if (!ev || ev.layer === "private") fail("CAL_NOT_FOUND");
    if (!can(ev.layer, ev.club_name)) fail("CAL_FORBIDDEN");
    const { data, error: e2 } = await admin.from("calendar_rsvp").select("club_name,person_key,full_name,nickname,guest_of,guest_role,proxy_by,created_at").eq("event_id", ev.id).order("created_at");
    if (e2) dbFail(e2);
    return { ok: true, title: ev.title, people: (data || []).map((r: Any) => ({ club: r.club_name, name: r.full_name, nickname: r.nickname || "", guest: rsvpIsGuest(r), role: r.guest_role || "", proxy: !!r.proxy_by, at: r.created_at })) };
  }

  // 執秘：這個報名活動（大類id::子活動名稱）裡，本社社友在 LINE 按了「我要參加」的名單
  if (action === "cal_desk_rsvp") {
    const key = String(body.key || ""), target = isAdmin ? String(body.targetClub || "") : club;
    if (!key || !target) fail("BAD_REQUEST");
    const { data: evs, error } = await admin.from("calendar_events").select("id,title,layer,club_name,status").eq("registration_key", key);
    if (error) dbFail(error);
    const ids = (evs || []).filter((e: Any) => e.status !== "cancelled" && (e.layer === "district" || (e.layer === "club" && e.club_name === target))).map((e: Any) => e.id);
    if (!ids.length) return { ok: true, people: [], linked: (evs || []).length > 0 };
    const { data, error: e2 } = await admin.from("calendar_rsvp").select("event_id,person_key,full_name,nickname,created_at").in("event_id", ids).eq("club_name", target).order("created_at");
    if (e2) dbFail(e2);
    const seen = new Set<string>(), people: Any[] = [];
    for (const r of data || []) if (!seen.has(r.person_key)) { seen.add(r.person_key); people.push({ key: r.person_key, name: r.full_name, nickname: r.nickname || "", at: r.created_at }); }
    return { ok: true, linked: true, people };
  }

  // 主委在「活動設定與費用金額」填了活動日期 → 同步成一筆地區行程（對應該報名活動）。
  // 認證：後台密碼，或「這個活動的主委社」的社登入密碼。日期留空＝移除自動建立的那筆（手動建立的行程不動）。
  if (action === "cal_desk_sync") {
    const key = String(body.key || "");
    if (!key) fail("BAD_REQUEST");
    if (!isAdmin && !(ctx.isChair && await ctx.isChair(club, key))) fail("CAL_FORBIDDEN");
    const roster = ctx.roster ? await ctx.roster(key) : { ok: false, title: "", persons: [] };
    if (!roster.ok) fail("CAL_REG_UNAVAILABLE");              // 活動不存在，或是不需要報名的分攤金／配合款
    const { data: found, error } = await admin.from("calendar_events").select("*").eq("layer", "district").eq("registration_key", key).order("created_at");
    if (error) dbFail(error);
    const ex = (found || [])[0] || null;
    const date = String(body.date || "").trim();
    if (!date) {
      if (ex && ex.created_by === AUTO_SYNC_MARK) {
        const { error: e0 } = await admin.from("calendar_events").delete().eq("id", ex.id);
        if (e0) dbFail(e0);
        return { ok: true, removed: true };
      }
      return { ok: true, removed: false };
    }
    const st = String(body.startTime || "").trim(), et = String(body.endTime || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (st && !/^\d{2}:\d{2}$/.test(st)) || (et && !/^\d{2}:\d{2}$/.test(et))) fail("CAL_BAD_TIME");
    const allDay = !st;                                         // 沒填開始時間＝全天
    const start = Date.parse(`${date}T${st || "00:00"}:00+08:00`);
    const end = Date.parse(`${date}T${allDay ? "23:59" : (et || st)}:00+08:00`);
    if (!Number.isFinite(start) || !Number.isFinite(end)) fail("CAL_BAD_TIME");
    if (end < start) fail("CAL_END_BEFORE_START");
    const times = { start_at: new Date(start).toISOString(), end_at: new Date(end).toISOString(), all_day: allDay };
    if (ex) {
      // 只更新日期時間；標題、地點等已經被行事曆管理者改過的內容不動
      const { data, error: e1 } = await admin.from("calendar_events").update({ ...times, updated_by: by, updated_at: new Date().toISOString() }).eq("id", ex.id).select().single();
      if (e1) dbFail(e1);
      return { ok: true, created: false, event: toView(data, true) };
    }
    const { data, error: e2 } = await admin.from("calendar_events").insert({ layer: "district", club_name: "", owner_key: "", title: roster.title || key.split("::")[1] || "活動", ...times, registration_key: key, created_by: AUTO_SYNC_MARK, updated_by: by }).select().single();
    if (e2) dbFail(e2);
    return { ok: true, created: true, event: toView(data, true) };
  }

  if (action === "cal_desk_save") {
    const input = body.event || {};
    const fields = normalizeEvent(input);
    if (input.id) {
      const { data: old, error } = await admin.from("calendar_events").select("*").eq("id", String(input.id)).maybeSingle();
      if (error) dbFail(error);
      if (!old) fail("CAL_NOT_FOUND");
      if (!can(old.layer, old.club_name)) fail("CAL_FORBIDDEN");
      const { data, error: e2 } = await admin.from("calendar_events").update({ ...fields, updated_by: by, updated_at: new Date().toISOString() }).eq("id", old.id).select().single();
      if (e2) dbFail(e2);
      return { ok: true, event: toView(data, true) };
    }
    const layer = String(input.layer || "");
    if (layer !== "district" && layer !== "club") fail("CAL_BAD_LAYER");
    const target = layer === "club" ? String(input.club || club) : "";
    if (layer === "club" && !target) fail("CAL_BAD_LAYER");
    if (!can(layer, target)) fail("CAL_FORBIDDEN");
    const { data, error } = await admin.from("calendar_events").insert({ layer, club_name: target, owner_key: "", ...fields, created_by: by, updated_by: by }).select().single();
    if (error) dbFail(error);
    return { ok: true, event: toView(data, true) };
  }

  if (action === "cal_desk_cancel" || action === "cal_desk_delete") {
    const { data: old, error } = await admin.from("calendar_events").select("*").eq("id", String(body.id || "")).maybeSingle();
    if (error) dbFail(error);
    if (!old) fail("CAL_NOT_FOUND");
    if (!can(old.layer, old.club_name)) fail("CAL_FORBIDDEN");    // 私人行程在 can() 裡一律 false
    if (action === "cal_desk_delete") {
      const { error: e2 } = await admin.from("calendar_events").delete().eq("id", old.id);
      if (e2) dbFail(e2);
      return { ok: true };
    }
    const status = body.cancelled === false ? "confirmed" : "cancelled";
    const { data, error: e3 } = await admin.from("calendar_events").update({ status, updated_by: by, updated_at: new Date().toISOString() }).eq("id", old.id).select().single();
    if (e3) dbFail(e3);
    return { ok: true, event: toView(data, true) };
  }
  return fail("BAD_REQUEST");
}

// ---------- 後台動作（電腦版 admin-calendar.html，用後台密碼把關） ----------
export interface AdminCtx { admin: Any; password: string; members: () => Promise<Record<string, Any[]>>; clubInfos: () => Promise<{ name: string; division: string; code: string }[]> }
// 這一筆「表示參加」是不是寶尊眷：社友帶來的（guest_of），或執秘代登記時社友庫標為寶尊眷的（guest_role）
const rsvpIsGuest = (r: Any) => !!(r && (r.guest_of || r.guest_role));
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
