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
export interface CalGov { club: string; key: string; name: string; nickname: string }
// secretary＝總監秘書（governor_cc）；govs＝這位秘書可以代管行事曆的總監（後台指定為 governor 的人，不含自己）
export interface CalRoles { district: boolean; clubs: string[]; governor: boolean; secretary?: boolean; govs?: CalGov[] }

export const LAYERS = ["district", "club", "private"];
const LIMITS: Record<string, number> = { title: 100, location: 200, address: 300, dressCode: 100, contactPerson: 50, contactPhone: 50, notes: 2000 };
const MAX_RANGE_MS = 400 * 86400_000;
const IMPORT_MAX = 300;          // Excel 匯入一次最多幾筆

const clip = (v: Any, n: number) => String(v == null ? "" : v).trim().slice(0, n);

// 把這位社友的角色資料列整理成好用的樣子
export function rolesOf(rows: Any[]): CalRoles {
  const r: CalRoles = { district: false, clubs: [], governor: false };
  for (const x of rows || []) {
    if (x.role === "district_editor") r.district = true;
    else if (x.role === "governor") r.governor = true;
    else if (x.role === "governor_cc") r.secretary = true;
    else if (x.role === "club_editor" && x.managed_club && !r.clubs.includes(x.managed_club)) r.clubs.push(x.managed_club);
  }
  return r;
}

// 能不能新增／修改／刪除這個行程（權限判斷集中在這裡）
export function canWrite(layer: string, row: { club_name?: string; owner_key?: string }, me: CalMe, roles: CalRoles): boolean {
  if (layer === "district") return roles.district;
  if (layer === "club") return roles.clubs.includes(String(row.club_name || ""));
  if (layer === "private") return (row.club_name === me.club && row.owner_key === me.key) || isGovOf(roles, String(row.club_name || ""), String(row.owner_key || ""));
  return false;
}
// 這筆私人行程的主人，是不是這位總監秘書代管的總監
export const isGovOf = (roles: CalRoles, club: string, key: string) => !!roles.secretary && (roles.govs || []).some((g) => g.club === club && g.key === key);

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
  const r = rolesOf(data || []);
  if (r.secretary) {
    // 總監秘書：找出後台指定的總監（通常一位），秘書可以看、也可以代為新增修改他的私人行程
    const { data: gs, error: e2 } = await admin.from("calendar_roles").select("club_name,person_key,full_name,nickname").eq("role", "governor");
    if (e2) dbFail(e2);
    r.govs = (gs || []).filter((g: Any) => g.club_name === me.club && g.person_key !== me.key)      // 總監秘書與總監必須同社（使用者規定）
      .map((g: Any) => ({ club: String(g.club_name), key: String(g.person_key), name: String(g.full_name || ""), nickname: String(g.nickname || "") }));
  }
  return r;
}
// 前端送來的 forGov（要代管哪位總監）→ 確認我真的是他的秘書，回傳那位總監；沒帶回 null；不是他的秘書就拒絕
function govTarget(body: Any, roles: CalRoles, field = "forGov"): CalGov | null {
  const f = body && body[field];
  if (!f) return null;
  const g = (roles.secretary ? roles.govs || [] : []).find((x) => x.club === String(f.club || "") && x.key === String(f.key || ""));
  if (!g) fail("CAL_FORBIDDEN");
  return g as CalGov;
}
async function loadTypes(admin: Any) {
  const { data, error } = await admin.from("calendar_event_types").select("id,name,sort_order").order("sort_order").order("id");
  if (error) dbFail(error);
  return (data || []).map((t: Any) => ({ id: t.id, name: t.name }));
}
const byMe = (me: CalMe) => `${me.name}（${me.club}）`;
const bySecretary = (me: CalMe) => `總監秘書 ${me.name}（${me.club}）代為登記`;
// 「與總監同行」的行程：秘書在自己的行事曆新增時勾選同步，實際只存一筆在總監名下，用這個標記讓它也出現在秘書自己的行事曆
// （只有一筆，所以誰改了兩邊都一起變）。標記寫在 created_by，之後修改不會動到它。
export const syncMark = (me: CalMe) => `總監秘書 ${me.name}（${me.club}）同行`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- 社友動作 ----------
// 報名系統的名單（由 lib.ts 以 CheckinCore.buildRoster 算出，與報到、推播同一套算法）
export interface RegDeps {
  roster: (eventKey: string) => Promise<{ ok: boolean; title: string; persons: Any[] }>;
  // 這位社友的「家人」（社友庫裡互為寶尊眷的人）。每個社的社友庫都在同一包資料裡，比較大，所以只有需要時才讀（自動更新時不讀）
  family?: (club: string, personKey: string, name: string) => Promise<{ key: string; name: string; nickname: string; role: string }[]>;
  members?: (club: string) => Promise<Any[]>;          // 該社的社友庫（出席率報表用）
  stats?: StatDeps;                                     // 報名／繳費統計（LINE「📊 報名狀況」）
}
// 報名／繳費統計：算法在 checkin-core.js 的 eventStats（主委後台圖表用同一份），由 lib.ts 讀資料後提供
export interface StatDeps {
  events: () => Promise<{ key: string; catName: string; subName: string }[]>;
  of: (eventKey: string) => Promise<Any>;
}
// 活動日期：主委沒填的，用行事曆上對應這個活動的行程日期補（今天以後最近的一場，沒有就取最後一場；已取消與私人行程不算）
export async function fillStatDates(admin: Any, list: Any[], now = Date.now()): Promise<void> {
  if (!list.some((s) => !s.date)) return;
  const q = await admin.from("calendar_events").select("registration_key,start_at,status,layer").limit(2000);
  const today = new Date(now + 8 * 3600_000).toISOString().slice(0, 10), byKey = new Map<string, string[]>();
  for (const r of q.error ? [] : q.data || []) {
    if (!r.registration_key || r.status === "cancelled" || r.layer === "private") continue;
    const d = new Date(Date.parse(r.start_at) + 8 * 3600_000).toISOString().slice(0, 10);
    byKey.set(r.registration_key, [...(byKey.get(r.registration_key) || []), d]);
  }
  for (const s of list) {
    if (s.date) continue;
    const ds = (byKey.get(s.key) || []).sort();
    s.date = ds.find((d) => d >= today) || ds[ds.length - 1] || "";
  }
}

// =====================================================================
// 活動結束滿一週的「備份提醒」：每晚排程順便檢查，推播給行事曆後台「⑥」指定的系統管理者（可多人＝備援人員）。
//   條件：活動日期在 7～21 天前（多留兩週，排程哪天失敗隔天還會補發）、還有報名或已繳紀錄、活動日期之後還沒備份過、這個活動這個日期還沒提醒過。
//   收件人與「已提醒」紀錄都放在 calendar_settings（key＝backup_notify／backup_reminded::<活動key>::<日期>），不需要新資料表。
//   只是提醒：備份並清空仍要最高管理員登入報名系統自己按（要先確認帳務結清）。分攤金／配合款沒有日期，不會提醒。
// =====================================================================
export const BACKUP_NOTIFY_KEY = "backup_notify";
export const BACKUP_REMIND_AFTER_DAYS = 7, BACKUP_REMIND_WINDOW_DAYS = 21;
export interface BackupPerson { club: string; key: string; name: string; nickname: string }
export async function loadBackupRecipients(admin: Any): Promise<BackupPerson[]> {
  const { data, error } = await admin.from("calendar_settings").select("value").eq("key", BACKUP_NOTIFY_KEY).maybeSingle();
  if (error || !data) return [];
  try { const a = JSON.parse(String(data.value || "[]")); return Array.isArray(a) ? a.filter((p: Any) => p && p.club && p.key) : []; } catch (_e) { return []; }
}
async function lineIdOf(admin: Any, club: string, key: string): Promise<string> {
  const { data, error } = await admin.from("line_bindings").select("line_user_id").eq("club_name", club).eq("person_key", key).maybeSingle();
  return error || !data ? "" : String(data.line_user_id);
}
// 目前「該備份了」的活動
export async function backupDueEvents(admin: Any, stats: StatDeps, now = Date.now()): Promise<Any[]> {
  const day = (n: number) => new Date(now + 8 * 3600_000 - n * 86400_000).toISOString().slice(0, 10);
  const latest = day(BACKUP_REMIND_AFTER_DAYS), earliest = day(BACKUP_REMIND_WINDOW_DAYS);
  const list: Any[] = [];
  for (const ev of await stats.events()) { const st = await stats.of(ev.key); if (st && st.ok && st.mode !== "apportion") list.push(st); }
  await fillStatDates(admin, list, now);
  const out: Any[] = [];
  for (const s of list) {
    if (!s.date || s.date > latest || s.date < earliest) continue;
    if (!((s.regClubs || 0) > 0 || (s.paidClubs || 0) > 0)) continue;                 // 已經沒有資料（清空過了）
    const done = await admin.from("calendar_settings").select("key").eq("key", `backup_reminded::${s.key}::${s.date}`).maybeSingle();
    if (!done.error && done.data) continue;                                           // 提醒過了
    const arch = await admin.from("event_archives").select("id,archived_at").eq("event_key", s.key).gte("archived_at", s.date + "T00:00:00+08:00").limit(1);
    if (!arch.error && (arch.data || []).length) continue;                            // 活動後已經備份過
    out.push({ key: s.key, catName: s.catName, subName: s.subName, date: s.date, regClubs: s.regClubs || 0, people: s.people || 0, paidClubs: s.paidClubs || 0, paidAmt: s.paidAmt || 0 });
  }
  return out;
}
export function backupReminderText(events: Any[], test = false): string {
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  const lines = events.map((e) => `・${e.subName}（${md(e.date)}）\n　報名 ${e.regClubs} 社 ${e.people} 人、已繳 ${e.paidClubs} 社`);
  return `${test ? "【測試】" : ""}📦 活動備份提醒\n\n以下活動已結束滿一週，資料還沒有備份並清空：\n${lines.join("\n")}\n\n請以最高管理員登入報名系統，切到該活動，在主委後台「📦 歷屆備份與清空本活動」按「備份並清空」。\n請先確認帳務都已結清；每個活動只提醒一次。`;
}
export async function backupReminder(admin: Any, o: { stats: StatDeps; send?: (to: string, messages: Any[]) => Promise<void>; test?: boolean; now?: number }): Promise<Any> {
  const now = o.now || Date.now();
  const people = await loadBackupRecipients(admin);
  const recipients: Any[] = [];
  for (const p of people) recipients.push({ ...p, lineId: await lineIdOf(admin, p.club, p.key) });
  const due = o.test ? [] : await backupDueEvents(admin, o.stats, now);
  const view = (status: (r: Any) => string) => recipients.map((r) => ({ club: r.club, key: r.key, name: r.name, nickname: r.nickname, status: status(r) }));
  if (!o.send) return { ok: true, due, sent: 0, recipients: view((r) => r.lineId ? "PREVIEW" : "NOT_BOUND") };
  const events = o.test ? [{ subName: "（這是測試，不是真的提醒）", date: new Date(now + 8 * 3600_000).toISOString().slice(0, 10), regClubs: 0, people: 0, paidClubs: 0 }] : due;
  if (!events.length || !recipients.length) return { ok: true, due, sent: 0, recipients: view((r) => r.lineId ? "NO_EVENTS" : "NOT_BOUND") };
  const msg = [{ type: "text", text: backupReminderText(events, !!o.test) }];
  let sent = 0; const st = new Map<string, string>();
  for (const r of recipients) {
    const id = r.club + "\u0001" + r.key;
    if (!r.lineId) { st.set(id, "NOT_BOUND"); continue; }
    try { await o.send(r.lineId, msg); sent++; st.set(id, "SENT"); } catch (_e) { st.set(id, "FAILED"); }
  }
  if (sent && !o.test) for (const e of due) await admin.from("calendar_settings").upsert({ key: `backup_reminded::${e.key}::${e.date}`, value: new Date(now).toISOString() }, { onConflict: "key" });
  return { ok: true, due, sent, recipients: view((r) => st.get(r.club + "\u0001" + r.key) || "") };
}

export const STAT_ALL = "*";      // calendar_stat_viewers.event_key＝* 代表「全部活動」
// 這個人可以看哪些活動的報名狀況：總監、總監秘書＝全部；其餘看後台指定（calendar_stat_viewers）。資料表還沒建立＝沒有人被指定
export async function statAccess(admin: Any, me: CalMe, roles: CalRoles): Promise<{ all: boolean; keys: Set<string> }> {
  if (roles.governor || roles.secretary) return { all: true, keys: new Set() };
  const { data, error } = await admin.from("calendar_stat_viewers").select("event_key").eq("club_name", me.club).eq("person_key", me.key);
  const keys = new Set<string>(error ? [] : (data || []).map((r: Any) => String(r.event_key)));
  return { all: keys.has(STAT_ALL), keys };
}

// =====================================================================
// 出席率報表（社友本人、社長／秘書在 LINE；執秘在報名系統）——三邊同一套算法，都在雲端算好再回傳。
//   例會：本社的社內行程（開放參加、或已有出席紀錄；已取消的不算）。只有「已記錄出席」的場次列入分母。
//   補出席：地區活動的報到紀錄（event_checkins，status＝in，本社、本人，自動）＋執秘手動登記的補出席（calendar_makeups，例如友社例會）。
//   出席率＝(例會出席＋補出席) ÷ 已記錄的例會場數（分母固定是本社例會，所以可以超過 100%）；另附純例會出席率。
//   periods：[{id, from, to}]（最多 3 段，例如上半年、全年），每段各算一次。
// =====================================================================
const coreOf = () => (globalThis as Any).CheckinCore || null;
export const MAKEUP_KINDS = ["友社例會", "地區活動", "其他"];
export function memberRank(m: Any): number {
  const C = coreOf();
  if (C && C.memberRoleRank) return C.memberRoleRank(m);
  const r = String((m && m.role) || "").trim().toUpperCase();
  return r === "P" || r === "社長" ? 0 : r === "S" || r === "秘書" ? 1 : 2;
}
// 誰可以在 LINE 看全社出席率：最高管理者在後台設定過的社＝只有勾選的人；沒設定過＝社長（P）、秘書（S）。
// 回傳 null＝沒設定（用預設）。資料表還沒建立時也當作沒設定，不讓 LINE 出席頁壞掉。
export async function loadReportViewers(admin: Any, club: string): Promise<string[] | null> {
  const { data, error } = await admin.from("calendar_report_viewers").select("viewers").eq("club_name", club).maybeSingle();
  if (error) {
    if (/does not exist|schema cache|could not find|PGRST20[25]|42P01/i.test(String(error.message || "") + " " + String(error.code || ""))) return null;
    dbFail(error);
  }
  return data && Array.isArray(data.viewers) ? data.viewers.map(String) : null;
}
export const canViewClubReport = (m: Any, viewers: string[] | null) =>
  !!m && (viewers ? viewers.includes(`${m.name || ""}|${m.nickname || ""}`) : memberRank(m) <= 1);
export async function attendanceReport(admin: Any, club: string, periodsIn: Any, members: Any[], onlyKey?: string): Promise<Any> {
  const periods = (Array.isArray(periodsIn) ? periodsIn : []).slice(0, 3).map((p: Any) => ({ id: String(p && p.id || "").slice(0, 20), from: Date.parse(String(p && p.from || "")), to: Date.parse(String(p && p.to || "")) }));
  if (!periods.length || periods.some((p) => !p.id || !Number.isFinite(p.from) || !Number.isFinite(p.to) || p.to < p.from || p.to - p.from > MAX_RANGE_MS)) fail("CAL_BAD_TIME");
  const from = Math.min(...periods.map((p) => p.from)), to = Math.max(...periods.map((p) => p.to));
  if (to - from > MAX_RANGE_MS) fail("CAL_BAD_TIME");
  const fromIso = new Date(from).toISOString(), toIso = new Date(to).toISOString();
  const { data: evs, error } = await admin.from("calendar_events").select("id,title,start_at,end_at,all_day,status,rsvp_enabled,event_type_id")
    .eq("layer", "club").eq("club_name", club).gte("start_at", fromIso).lte("start_at", toIso).order("start_at").limit(1000);
  if (error) dbFail(error);
  const live = (evs || []).filter((e: Any) => e.status !== "cancelled");
  const ids = live.map((e: Any) => e.id);
  let at: Any[] = [], rs: Any[] = [];
  if (ids.length) {
    const [a, r] = await Promise.all([
      admin.from("calendar_attendance").select("event_id,person_key,full_name,nickname,role,is_guest").in("event_id", ids).eq("club_name", club),
      admin.from("calendar_rsvp").select("event_id,person_key,full_name,nickname,guest_of,guest_role").in("event_id", ids).eq("club_name", club),
    ]);
    if (a.error) dbFail(a.error);
    if (r.error) dbFail(r.error);
    at = a.data || []; rs = r.data || [];
  }
  // 地區活動報到（補出席）：分頁讀取，一次最多 1000 筆
  let ck: Any[] = [];
  for (let off = 0; off < 10000; off += 1000) {
    let q = admin.from("event_checkins").select("event_key,person_key,full_name,nickname,checked_in_at").eq("club_name", club).eq("status", "in")
      .gte("checked_in_at", fromIso).lte("checked_in_at", toIso).order("checked_in_at");
    if (onlyKey) q = q.eq("person_key", onlyKey);
    const { data, error: e3 } = await (q.range ? q.range(off, off + 999) : q);
    if (e3) dbFail(e3);
    ck = ck.concat(data || []);
    if (!q.range || (data || []).length < 1000) break;
  }
  // 手動登記的補出席（日期是台灣日期）
  const tpDay = (ms: number) => new Date(ms + 8 * 3600_000).toISOString().slice(0, 10);
  let mq = admin.from("calendar_makeups").select("id,person_key,full_name,nickname,made_on,kind,note,created_by").eq("club_name", club).gte("made_on", tpDay(from)).lte("made_on", tpDay(to)).order("made_on");
  if (onlyKey) mq = mq.eq("person_key", onlyKey);
  const { data: mkRows, error: e4 } = await mq;
  if (e4) dbFail(e4);
  const manual: Any[] = (mkRows || []).map((x: Any) => ({ id: x.id, key: x.person_key, name: x.full_name, nickname: x.nickname || "", date: x.made_on, kind: x.kind, note: x.note || "", by: x.created_by || "" }));
  const recorded = new Set<string>(at.map((x) => x.event_id));
  const meetings = live.filter((e: Any) => e.rsvp_enabled || recorded.has(e.id) || rs.some((x) => x.event_id === e.id))
    .map((e: Any) => ({ id: e.id, title: e.title, start: e.start_at, allDay: !!e.all_day, typeId: e.event_type_id, recorded: recorded.has(e.id) }));
  const meetIds = new Set<string>(meetings.map((m: Any) => m.id));
  const dist = new Map<string, { key: string; title: string; date: string }>();
  for (const c of ck) {
    const d = dist.get(c.event_key);
    if (!d) dist.set(c.event_key, { key: c.event_key, title: String(c.event_key).split("::").slice(1).join("::") || c.event_key, date: c.checked_in_at });
    else if (c.checked_in_at < d.date) d.date = c.checked_in_at;
  }
  const isExt = (k: string) => k.startsWith("guest:");
  const people = new Map<string, Any>();
  const C = coreOf();
  const list = (C && C.sortMembers ? C.sortMembers(members || []) : (members || [])).filter((m: Any) => m && m.name);
  for (const m of list) people.set(personKey(m), { key: personKey(m), name: m.name, nickname: m.nickname || "", role: m.role || "", guest: !!m.spouseOfId || /眷/.test(String(m.role || "")), rank: memberRank(m), left: false });
  const touch = (k: string, info: Any) => { if (!isExt(k) && !people.has(k)) people.set(k, { key: k, name: info.name, nickname: info.nickname || "", role: info.role || "", guest: !!info.guest, rank: 2, left: true }); };
  for (const x of at) if (meetIds.has(x.event_id)) touch(x.person_key, { name: x.full_name, nickname: x.nickname, role: x.role, guest: x.is_guest });
  for (const x of rs) if (meetIds.has(x.event_id)) touch(x.person_key, { name: x.full_name, nickname: x.nickname, role: x.guest_role, guest: !!(x.guest_of || x.guest_role) });
  for (const x of ck) touch(x.person_key, { name: x.full_name, nickname: x.nickname });
  for (const x of manual) touch(x.key, { name: x.name, nickname: x.nickname });
  const dayIn = (d: string, p: Any) => d >= tpDay(p.from) && d <= tpDay(p.to);     // 台灣日期落在期間內
  const inP = (iso: string, p: Any) => { const t = Date.parse(iso); return t >= p.from && t <= p.to; };
  const meetById = new Map<string, Any>(meetings.map((m: Any) => [m.id, m]));
  const out: Any[] = [];
  for (const p of people.values()) {
    if (onlyKey && p.key !== onlyKey) continue;
    const att = at.filter((x) => x.person_key === p.key && meetIds.has(x.event_id)).map((x) => x.event_id);
    const rsv = rs.filter((x) => x.person_key === p.key && meetIds.has(x.event_id)).map((x) => x.event_id);
    const dk = [...new Set<string>(ck.filter((x) => x.person_key === p.key).map((x) => x.event_key))];
    const mine = manual.filter((x) => x.key === p.key);
    const sum: Record<string, Any> = {};
    for (const per of periods) {
      const held = meetings.filter((m: Any) => m.recorded && inP(m.start, per)).length;
      const attended = att.filter((id) => inP(meetById.get(id).start, per)).length;
      const district = dk.filter((k) => inP(dist.get(k)!.date, per)).length;
      const manualN = mine.filter((x) => dayIn(x.date, per)).length;
      const makeup = district + manualN;
      const effective = attended + makeup;
      sum[per.id] = { held, attended, makeup, district, manual: manualN, effective, rate: held ? effective / held : null, meetRate: held ? attended / held : null, rsvp: rsv.filter((id) => inP(meetById.get(id).start, per)).length };
    }
    out.push({ ...p, att, rsvp: rsv, dist: dk, mk: mine.map((x) => x.id), sum });
  }
  const distList = [...dist.values()].filter((d) => !onlyKey || out.some((p) => p.dist.includes(d.key))).sort((a, b) => a.date.localeCompare(b.date));
  return { ok: true, club, manual: manual.filter((x) => out.some((p) => p.key === x.key)), periods: periods.map((p) => ({ id: p.id, from: new Date(p.from).toISOString(), to: new Date(p.to).toISOString(), held: meetings.filter((m: Any) => m.recorded && inP(m.start, p)).length })), meetings, district: distList, people: out };
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
    myGuests: (data || []).filter((r: Any) => r.guest_of === me.key && !r.proxy_by).map((r: Any) => r.person_key),   // 執秘代登記的同行者不算（社友在 LINE 改寶尊眷時不會刪掉）    // 我已經幫哪些寶尊眷登記
  };
  // listed＝已經在名單上、但不是我帶的（例如執秘代為登記）：前端顯示「已登記」，不能再勾
  const listedKeys = new Set<string>((data || []).filter((r: Any) => r.guest_of !== me.key).map((r: Any) => r.person_key));
  if (withFamily && reg && reg.family) out.family = (await reg.family(me.club, me.key, me.name)).map((f) => ({ ...f, registered: formalKeys.has(f.key), listed: !formalKeys.has(f.key) && listedKeys.has(f.key) }));
  return out;
}

// ---------- 總監秘書按「我要參加」時，同時幫總監登記（總監的「私人」頁與每日推播就會有這筆） ----------
// 總監秘書與總監一定同社（後台指定時會檢查），所以秘書看得到的地區／社內行程總監也都看得到：
// 直接幫總監寫一筆參加紀錄（proxy_by＝秘書；秘書取消時只收回自己代登記的，總監自己登記的不動）。
const secProxy = (me: CalMe) => `總監秘書 ${me.name}（${me.club}）`;
async function govSyncState(admin: Any, ev: Any, me: CalMe, roles: CalRoles): Promise<Any | null> {
  const g = roles.secretary ? (roles.govs || [])[0] : null;
  if (!g) return null;
  const { data, error } = await admin.from("calendar_rsvp").select("proxy_by").eq("event_id", ev.id).eq("club_name", g.club).eq("person_key", g.key).maybeSingle();
  if (error) dbFail(error);
  return { name: g.nickname || g.name, joined: !!data, byMe: !!data && data.proxy_by === secProxy(me) };
}
async function govSyncSet(admin: Any, ev: Any, me: CalMe, roles: CalRoles, on: boolean) {
  for (const g of (roles.secretary ? roles.govs || [] : [])) {
    if (on) {
      const { error } = await admin.from("calendar_rsvp").upsert(
        { event_id: ev.id, club_name: g.club, person_key: g.key, full_name: g.name, nickname: g.nickname || "", proxy_by: secProxy(me) },
        { onConflict: "event_id,club_name,person_key", ignoreDuplicates: true });      // 總監自己已經登記過就不動
      if (error) dbFail(error);
    } else {
      const { error } = await admin.from("calendar_rsvp").delete().eq("event_id", ev.id).eq("club_name", g.club).eq("person_key", g.key).eq("proxy_by", secProxy(me));   // 只收回我代登記的
      if (error) dbFail(error);
    }
  }
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
    const sa = await statAccess(admin, me, roles);
    return { ok: true, me, roles, types: await loadTypes(admin), canStats: sa.all || sa.keys.size > 0, statAll: sa.all, statKeys: sa.all ? [] : [...sa.keys] };
  }

  // ---------- 📊 報名／繳費狀況（總監、總監秘書，以及後台指定的人） ----------
  // 帶 key＝只看那一個活動（行程詳細頁用）；不帶＝我可以看的所有活動
  if (action === "cal_stats") {
    const sa = await statAccess(admin, me, roles);
    if (!sa.all && !sa.keys.size) fail("CAL_FORBIDDEN");
    if (!reg || !reg.stats) fail("CAL_REG_UNAVAILABLE");
    const one = String(body.key || "");
    if (one) {
      if (!sa.all && !sa.keys.has(one)) fail("CAL_FORBIDDEN");
      const st = await reg!.stats!.of(one);
      return { ok: true, at: new Date().toISOString(), events: st && st.ok ? [st] : [] };
    }
    const out: Any[] = [];
    for (const ev of await reg!.stats!.events()) {
      if (!sa.all && !sa.keys.has(ev.key)) continue;
      const st = await reg!.stats!.of(ev.key);
      if (st && st.ok) out.push(st);
    }
    await fillStatDates(admin, out);      // 畫面預設只列「今天起兩個月內」的活動
    return { ok: true, at: new Date().toISOString(), all: sa.all, events: out };
  }

  if (action === "cal_list") {
    const from = Date.parse(String(body.from || "")), to = Date.parse(String(body.to || ""));
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from || to - from > MAX_RANGE_MS) fail("CAL_BAD_TIME");
    const fromIso = new Date(from).toISOString(), toIso = new Date(to).toISOString();
    // 總監秘書看「總監的行事曆」：地區＋總監所屬社＋總監的私人行程；只有總監的私人行程可以改
    const gov = govTarget(body, roles);
    const who = gov ? { club: gov.club, key: gov.key } : { club: me.club, key: me.key };
    // 地區＋本社＋自己的私人，各查一次再合併（不用 or 字串，避免社名裡的符號弄壞查詢）
    const base = () => admin.from("calendar_events").select("*").gte("end_at", fromIso).lte("start_at", toIso).order("start_at").limit(1000);
    const [d, c, p] = await Promise.all([
      base().eq("layer", "district"),
      base().eq("layer", "club").eq("club_name", who.club),
      base().eq("layer", "private").eq("club_name", who.club).eq("owner_key", who.key),
    ]);
    for (const r of [d, c, p]) if (r.error) dbFail(r.error);
    const rows = [...(d.data || []), ...(c.data || []), ...(p.data || [])]
      .sort((a: Any, b: Any) => String(a.start_at).localeCompare(String(b.start_at)));
    if (gov) {
      // 總監參加了哪些活動（我要參加／正式報名）：秘書在「總監私人」頁才看得到同步進來的地區、社內活動
      const gj = await joinedMap(admin, rows, { club: gov.club, key: gov.key, name: gov.name, nickname: gov.nickname }, reg);
      return { ok: true, forGov: gov, events: rows.map((r: Any) => ({ ...toView(r, r.layer === "private", gj.get(r.id) || null), withGov: r.layer === "private" && r.created_by === syncMark(me) })) };
    }
    // 總監秘書：我勾了「同時加入總監行事曆」的行程（存在總監名下）也列在我自己的行事曆
    const shared = new Set<string>();
    for (const gv of (roles.secretary ? roles.govs || [] : [])) {
      const q = await base().eq("layer", "private").eq("club_name", gv.club).eq("owner_key", gv.key).eq("created_by", syncMark(me));
      if (q.error) dbFail(q.error);
      for (const r of q.data || []) { shared.add(r.id); rows.push(r); }
    }
    if (shared.size) rows.sort((a: Any, b: Any) => String(a.start_at).localeCompare(String(b.start_at)));
    const joined = await joinedMap(admin, rows, me, reg);
    return { ok: true, events: rows.map((r: Any) => ({ ...toView(r, canWrite(r.layer, r, me, roles), joined.get(r.id) || null), withGov: shared.has(r.id) })) };
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
      const proxy = old.layer === "private" && isGovOf(roles, old.club_name, old.owner_key);      // 秘書改總監的私人行程
      const { data, error: e2 } = await admin.from("calendar_events").update({ ...fields, updated_by: proxy ? bySecretary(me) : byMe(me), updated_at: new Date().toISOString() }).eq("id", id).select().single();
      if (e2) dbFail(e2);
      return { ok: true, event: toView(data, true) };
    }
    const gov = govTarget(body, roles);
    if (gov) {
      // 總監秘書代總監新增：只能是「總監的私人行程」，存在總監名下（總監自己看得到、每日推播也會包含）
      delete fields.registration_key; delete fields.rsvp_enabled;
      const { data, error } = await admin.from("calendar_events").insert({ layer: "private", club_name: gov.club, owner_key: gov.key, ...fields, created_by: bySecretary(me), updated_by: bySecretary(me) }).select().single();
      if (error) dbFail(error);
      return { ok: true, event: toView(data, true) };
    }
    const layer = String(input.layer || "");
    if (!LAYERS.includes(layer)) fail("CAL_BAD_LAYER");
    // 總監秘書在自己的行事曆新增私人行程並勾「同時加入總監行事曆」：只存一筆在總監名下，秘書自己的行事曆也會列出（兩邊同步）
    const share = layer === "private" ? govTarget(body, roles, "shareGov") : null;
    if (share) {
      delete fields.registration_key; delete fields.rsvp_enabled;
      const { data, error } = await admin.from("calendar_events").insert({ layer: "private", club_name: share.club, owner_key: share.key, ...fields, created_by: syncMark(me), updated_by: bySecretary(me) }).select().single();
      if (error) dbFail(error);
      return { ok: true, event: { ...toView(data, true), withGov: true } };
    }
    const row: Any = { layer, club_name: "", owner_key: "" };
    if (layer === "private") { delete fields.registration_key; delete fields.rsvp_enabled; }
    if (layer === "club") row.club_name = String(input.club || (roles.clubs.length === 1 ? roles.clubs[0] : ""));
    if (layer === "private") { row.club_name = me.club; row.owner_key = me.key; }
    if (!canWrite(layer, row, me, roles)) fail("CAL_FORBIDDEN");
    const { data, error } = await admin.from("calendar_events").insert({ ...row, ...fields, created_by: byMe(me), updated_by: byMe(me) }).select().single();
    if (error) dbFail(error);
    return { ok: true, event: toView(data, true) };
  }

  // ---------- 總監秘書在「總監的行事曆」裡，直接幫總監登記／取消參加地區、社內活動 ----------
  if (action === "cal_gov_rsvp") {
    const gov = govTarget(body, roles);
    if (!gov) fail("CAL_FORBIDDEN");
    const g = gov as CalGov;
    const { data: ev, error } = await admin.from("calendar_events").select("*").eq("id", String(body.id || "")).maybeSingle();
    if (error) dbFail(error);
    if (!ev || ev.layer === "private" || (ev.layer === "club" && ev.club_name !== g.club)) fail("CAL_NOT_FOUND");
    if (!ev.rsvp_enabled && !ev.registration_key) fail("CAL_REG_UNAVAILABLE");
    const gme = { club: g.club, key: g.key, name: g.name, nickname: g.nickname };
    if (body.join === true) {
      if (ev.status === "cancelled") fail("CAL_EVENT_CANCELLED");
      const { error: e1 } = await admin.from("calendar_rsvp").upsert(
        { event_id: ev.id, club_name: g.club, person_key: g.key, full_name: g.name, nickname: g.nickname || "", proxy_by: secProxy(me) },
        { onConflict: "event_id,club_name,person_key", ignoreDuplicates: true });
      if (e1) dbFail(e1);
    } else {
      if ((await joinedMap(admin, [ev], gme, reg)).get(ev.id) === "registered") fail("CAL_RSVP_LOCKED");      // 執秘已送出正式報名，要取消請洽執秘
      const { error: e2 } = await admin.from("calendar_rsvp").delete().eq("event_id", ev.id).eq("club_name", g.club).eq("person_key", g.key);
      if (e2) dbFail(e2);
    }
    return { ok: true, joined: (await joinedMap(admin, [ev], gme, reg)).get(ev.id) || null };
  }

  // ---------- 社內已報名名單、我要參加 ----------
  if (action === "cal_rsvp_status" || action === "cal_rsvp_set") {
    const { data: ev, error } = await admin.from("calendar_events").select("*").eq("id", String(body.id || "")).maybeSingle();
    if (error) dbFail(error);
    // 只有「看得到的」行程才查得到：地區行程，或本社的社內行程（私人行程沒有報名）
    if (!ev || ev.layer === "private" || (ev.layer === "club" && ev.club_name !== me.club)) fail("CAL_NOT_FOUND");
    if (action === "cal_rsvp_status") {
      // 自動更新（poll）時不需要家人名單，省掉讀取整包社友庫
      return { ok: true, ...(await rsvpStatus(admin, ev, me, reg, body.poll !== true)), gov: await govSyncState(admin, ev, me, roles) };
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
      // 總監秘書：withGov＝true 同時幫總監登記；false 收回我代總監登記的；沒帶＝不動
      if (body.withGov === true) await govSyncSet(admin, ev, me, roles, true);
      else if (body.withGov === false) await govSyncSet(admin, ev, me, roles, false);
    } else {
      if (st0.mine === "registered") fail("CAL_RSVP_LOCKED");       // 已由執秘送出正式報名，要取消請洽執秘
      const { error: e4 } = await rsvpTable().delete().eq("event_id", ev.id).eq("club_name", me.club).eq("person_key", me.key);
      if (e4) dbFail(e4);
      const { error: e5 } = await rsvpTable().delete().eq("event_id", ev.id).eq("club_name", me.club).eq("guest_of", me.key);   // 我帶的寶尊眷一併取消
      if (e5) dbFail(e5);
      await govSyncSet(admin, ev, me, roles, false);      // 我代總監登記的一併收回（總監自己登記的不動）
    }
    return { ok: true, ...(await rsvpStatus(admin, ev, me, reg, true)), gov: await govSyncState(admin, ev, me, roles) };
  }

  // ---------- 出席率：本人；可看全社的人＝後台設定的名單，沒設定時是社長（P）、秘書（S） ----------
  if (action === "cal_attend_report") {
    const list: Any[] = reg && reg.members ? await reg.members(me.club) : [];
    const mine = list.find((m: Any) => m && m.name && personKey(m) === me.key);
    const canClub = !!mine && canViewClubReport(mine, await loadReportViewers(admin, me.club));
    const scope = body.scope === "club" ? "club" : "me";
    if (scope === "club" && !canClub) fail("CAL_FORBIDDEN");
    const r = await attendanceReport(admin, me.club, body.periods, list, scope === "club" ? undefined : me.key);
    return { ...r, scope, canClub, me: me.key };
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
    const proxy = old.layer === "private" && isGovOf(roles, old.club_name, old.owner_key);
    const { data, error: e3 } = await admin.from("calendar_events").update({ status, updated_by: proxy ? bySecretary(me) : byMe(me), updated_at: new Date().toISOString() }).eq("id", id).select().single();
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
      // 只接受社友庫裡的人，以及這場執秘代登記的同行者（非社友）
      const { data: ext, error: e0 } = await admin.from("calendar_rsvp").select("person_key,full_name,guest_role").eq("event_id", ev.id).eq("club_name", ev.club_name);
      if (e0) dbFail(e0);
      for (const x of ext || []) if (isExtGuestKey(x.person_key)) byKey.set(x.person_key, { name: x.full_name, nickname: "", role: x.guest_role || "", spouseOfId: "ext" });
      const keys = [...new Set<string>((Array.isArray(body.keys) ? body.keys : []).map(String))].filter((k) => byKey.has(k));
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
    return { ok: true, title: ev.title, start: ev.start_at, club: ev.club_name, attended: (a.data || []).map((x: Any) => x.person_key), recorded: (a.data || []).length > 0, rsvp: (r.data || []).map((x: Any) => ({ key: x.person_key, name: x.full_name, nickname: x.nickname || "", guest: rsvpIsGuest(x), proxy: !!x.proxy_by, ext: isExtGuestKey(x.person_key), guestOf: x.guest_of || "", role: x.guest_role || "" })) };
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
      // 同行的非社友（子女、外勞、朋友、社友庫裡沒有資料的寶尊眷）：body.guests＝[{host, type, name}]，整批取代執秘代登記的這些列。
      // 舊版畫面沒有送 guests 時，不動既有的同行者。
      const replaceGuests = Array.isArray(body.guests);
      const proxied = (cur || []).filter((r: Any) => r.proxy_by && (replaceGuests || !isExtGuestKey(r.person_key))).map((r: Any) => r.person_key);
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
      if (replaceGuests) {
        // 帶人的社友要在名單上（執秘這次勾的，或本人在 LINE 登記的）
        const attending = new Set<string>([...wanted, ...(cur || []).filter((r: Any) => !r.proxy_by).map((r: Any) => r.person_key)]);
        const count = new Map<string, number>();
        for (const g of body.guests.slice(0, 200)) {
          const host = String((g && g.host) || ""), type = String((g && g.type) || "");
          if (!byKey.has(host) || !attending.has(host) || !EXT_GUEST_TYPES.includes(type)) continue;
          const n = (count.get(host) || 0) + 1; count.set(host, n);
          const hm = byKey.get(host), hostLabel = hm.nickname || hm.name;
          const name = String((g && g.name) || "").replace(/\s+/g, " ").trim().slice(0, 30) || `${hostLabel}的${type === "寶(尊)眷" ? "寶尊眷" : type}`;
          add.push({ event_id: ev.id, club_name: ev.club_name, person_key: `${EXT_GUEST_PREFIX}${host}:${n}`, full_name: name, nickname: "", guest_of: host, guest_role: type, proxy_by: by });
        }
      }
      for (const row of add) {
        const { error: e2 } = await rsvpTable().upsert(row, { onConflict: "event_id,club_name,person_key", ignoreDuplicates: true });
        if (e2) dbFail(e2);
      }
    }
    const { data, error: e3 } = await rsvpTable().select("person_key,full_name,nickname,guest_of,guest_role,proxy_by").eq("event_id", ev.id).eq("club_name", ev.club_name).order("created_at");
    if (e3) dbFail(e3);
    return { ok: true, title: ev.title, start: ev.start_at, club: ev.club_name, cancelled: ev.status === "cancelled",
      people: (data || []).map((r: Any) => ({ key: r.person_key, name: r.full_name, nickname: r.nickname || "", guest: rsvpIsGuest(r), proxy: !!r.proxy_by, ext: isExtGuestKey(r.person_key), guestOf: r.guest_of || "", role: r.guest_role || "" })) };
  }

  // ---------- 手動登記補出席（友社例會等）：新增／刪除 ----------
  if (action === "cal_desk_makeup_add" || action === "cal_desk_makeup_delete") {
    const target = isAdmin ? String(body.targetClub || "") : club;
    if (!target) fail("BAD_REQUEST");
    if (action === "cal_desk_makeup_delete") {
      const { data: row, error } = await admin.from("calendar_makeups").select("id,club_name").eq("id", Number(body.id) || 0).maybeSingle();
      if (error) dbFail(error);
      if (!row || row.club_name !== target) fail("CAL_NOT_FOUND");
      const { error: e2 } = await admin.from("calendar_makeups").delete().eq("id", row.id);
      if (e2) dbFail(e2);
      return { ok: true };
    }
    const list: Any[] = ctx.members ? await ctx.members(target) : [];
    const m = list.find((x: Any) => x && x.name && personKey(x) === String(body.person || ""));
    if (!m) fail("CAL_NOT_FOUND");                                    // 只能登記社友庫裡的人
    const date = String(body.date || "").trim(), kind = String(body.kind || "友社例會");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + "T00:00:00+08:00"))) fail("CAL_BAD_TIME");
    if (!MAKEUP_KINDS.includes(kind)) fail("BAD_REQUEST");
    const row = { club_name: target, person_key: personKey(m), full_name: m.name, nickname: m.nickname || "", made_on: date, kind, note: String(body.note || "").trim().slice(0, 100), created_by: by };
    const { data, error } = await admin.from("calendar_makeups").insert(row).select().single();
    if (error) dbFail(error);
    return { ok: true, makeup: { id: data.id, key: data.person_key, name: data.full_name, date: data.made_on, kind: data.kind, note: data.note } };
  }

  // ---------- 誰可以在 LINE 看全社出席率（執秘只能設定自己的社；後台可指定任何一社） ----------
  if (action === "cal_desk_viewers_get" || action === "cal_desk_viewers_save") {
    const target = isAdmin ? String(body.targetClub || "") : club;
    if (!target) fail("BAD_REQUEST");
    const list: Any[] = ctx.members ? await ctx.members(target) : [];
    if (action === "cal_desk_viewers_save" && !list.length) fail("CAL_NOT_FOUND");      // 沒有社友庫（或社名不對）就不寫入
    return await reportViewersAction(admin, target, list, body, action === "cal_desk_viewers_save", by);
  }

  // ---------- 出席率報表（全社，執秘／後台） ----------
  if (action === "cal_desk_attend_report") {
    const target = isAdmin ? String(body.targetClub || "") : club;
    if (!target) fail("BAD_REQUEST");
    const list: Any[] = ctx.members ? await ctx.members(target) : [];
    return await attendanceReport(admin, target, body.periods, list);
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
    const { data, error: e2 } = await admin.from("calendar_events").insert({ layer: "district", club_name: "", owner_key: "", title: roster.title || key.split("::")[1] || "活動", ...times, registration_key: key, rsvp_enabled: true, created_by: AUTO_SYNC_MARK, updated_by: by }).select().single();
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

  // ---------- Excel 匯入行程（前端用 SheetJS 讀檔、整理成行程，這裡逐筆檢查後一次寫入） ----------
  // body.events＝[{row, title, start, end, allDay, typeId, location, …, rsvpEnabled}]（最多 IMPORT_MAX 筆）；
  // body.dryRun＝true 時只檢查不寫入（預覽用）。同一層、同一社「標題＋開始時間」相同的行程視為重複，略過不匯入。
  if (action === "cal_desk_import") {
    const layer = String(body.layer || "");
    if (layer !== "district" && layer !== "club") fail("CAL_BAD_LAYER");
    const target = layer === "club" ? String((isAdmin ? body.targetClub : club) || "") : "";
    if (layer === "club" && !target) fail("CAL_BAD_LAYER");
    if (!can(layer, target)) fail("CAL_FORBIDDEN");
    const input: Any[] = Array.isArray(body.events) ? body.events : [];
    if (!input.length) fail("BAD_REQUEST");
    if (input.length > IMPORT_MAX) fail("CAL_IMPORT_TOO_MANY");
    const types = await loadTypes(admin);
    const typeIds = new Set(types.map((t: Any) => Number(t.id)));
    const ok: { row: number; fields: Any }[] = [], skipped: { row: number; reason: string }[] = [];
    const seen = new Map<string, number>();
    input.forEach((e: Any, i: number) => {
      const row = Number(e && e.row) || i + 1;
      let fields: Any;
      try { fields = normalizeEvent({ ...e, registrationKey: undefined, rsvpEnabled: e && e.rsvpEnabled === false ? false : true }); }
      catch (err: Any) { skipped.push({ row, reason: (err && err.code) || "BAD_REQUEST" }); return; }
      if (fields.event_type_id && !typeIds.has(fields.event_type_id)) fields.event_type_id = null;
      const k = fields.title + "|" + Date.parse(fields.start_at);
      if (seen.has(k)) { skipped.push({ row, reason: "DUP_IN_FILE:" + seen.get(k) }); return; }
      seen.set(k, row);
      ok.push({ row, fields });
    });
    // 與資料庫裡已有的行程比對（同層、同社、標題與開始時間相同）
    if (ok.length) {
      const starts = ok.map((x) => Date.parse(x.fields.start_at));
      let q = admin.from("calendar_events").select("title,start_at").eq("layer", layer)
        .gte("start_at", new Date(Math.min(...starts)).toISOString()).lte("start_at", new Date(Math.max(...starts)).toISOString()).limit(5000);
      if (layer === "club") q = q.eq("club_name", target);
      const { data: ex, error } = await q;
      if (error) dbFail(error);
      const have = new Set((ex || []).map((r: Any) => String(r.title).trim() + "|" + Date.parse(r.start_at)));
      for (let i = ok.length - 1; i >= 0; i--) {
        if (have.has(ok[i].fields.title + "|" + Date.parse(ok[i].fields.start_at))) { skipped.push({ row: ok[i].row, reason: "DUP_EXISTING" }); ok.splice(i, 1); }
      }
    }
    skipped.sort((a, b) => a.row - b.row);
    if (body.dryRun || !ok.length) return { ok: true, dryRun: !!body.dryRun, imported: 0, willImport: ok.map((x) => x.row), skipped };
    const rows = ok.map((x) => ({ layer, club_name: target, owner_key: "", ...x.fields, created_by: by, updated_by: by }));
    const { error } = await admin.from("calendar_events").insert(rows);
    if (error) dbFail(error);
    return { ok: true, dryRun: false, imported: rows.length, importedRows: ok.map((x) => x.row), skipped };
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

// =====================================================================
// 總監每日推播（規格 6.8）：每天晚上 8 點（pg_cron）把總監「明天」的行程用 LINE 卡片推給總監，並給總監秘書一份副本。
//   內容：總監的私人行程＋總監已參加（我要參加／正式報名）的地區與社內活動；沒表示參加的地區、社內行程不推。
//   收件人：calendar_roles 的 governor（總監本人）＋ governor_cc（總監秘書，收副本）；都要綁定過 LINE（line_bindings）。
//   內容：總監的「所有行程」＝地區＋總監所屬社的社內＋總監本人的私人行程（已取消的不列）。明天沒有行程就不推。
//   同一天、同一位總監、同一位收件人只推一次（calendar_digest_log），排程重複觸發也不會重發；後台「測試發送」不受此限也不記錄。
// =====================================================================
export interface DigestOpts {
  day?: string;                 // YYYY-MM-DD（台灣日期）；沒給＝明天
  liffId: string;               // 「查看詳情」按鈕要開的 LIFF
  send?: (to: string, messages: Any[]) => Promise<void>;   // 沒給＝只預覽（不發送）
  test?: boolean;               // 後台測試發送：標「測試」、不檢查也不寫發送紀錄
  reg?: RegDeps;                // 用來判斷總監是否已被執秘正式報名（沒給＝只看「我要參加」）
  now?: number;
}
const DIGEST_WD = ["日", "一", "二", "三", "四", "五", "六"];
const tpYmd = (ms: number) => new Date(ms + 8 * 3600_000).toISOString().slice(0, 10);
const tpHm = (ms: number) => new Date(ms + 8 * 3600_000).toISOString().slice(11, 16);
const LAYER_COLOR: Record<string, string> = { district: "#1D4ED8", club: "#B45309", private: "#2E7D32" };
const LAYER_NAME: Record<string, string> = { district: "地區", club: "社內", private: "私人" };
export function digestTimeText(e: Any, day: string): string {
  const s = Date.parse(e.start_at), en = Date.parse(e.end_at);
  const sd = tpYmd(s), ed = tpYmd(en);
  if (e.all_day) return sd < day || ed > day ? "全天（多天活動）" : "全天";
  const a = sd < day ? "（前一天開始）" : tpHm(s);
  const b = ed > day ? "（隔天結束）" : tpHm(en);
  if (sd === day && ed === day) return s === en ? a : `${a}–${b}`;
  return `${a} ～ ${b}`;
}
// 卡片裡的一筆行程（總監推播與聊天室回覆共用）：層級＋時間、標題、社名、地點、服裝、「查看詳情」
function eventBox(e: Any, day: string, base: string, first: boolean): Any {
  const uri = `${base}&ev=${encodeURIComponent(String(e.id))}&d=${day}`;
  const lines: Any[] = [
    { type: "text", text: `【${LAYER_NAME[e.layer] || ""}】${digestTimeText(e, day)}`, size: "sm", weight: "bold", color: LAYER_COLOR[e.layer] || "#334155", wrap: true },
    { type: "text", text: String(e.title || "（未命名）"), weight: "bold", size: "md", wrap: true, color: "#0F172A", margin: "xs" },
  ];
  if (e.layer === "club" && e.club_name) lines.push({ type: "text", text: e.club_name, size: "xs", color: "#94A3B8", wrap: true });
  if (e.location || e.address) lines.push({ type: "text", text: `📍 ${e.location || e.address}`, size: "sm", color: "#475569", wrap: true, margin: "xs" });
  if (e.dress_code) lines.push({ type: "text", text: `👔 ${e.dress_code}`, size: "sm", color: "#475569", wrap: true });
  lines.push({ type: "text", text: "查看詳情 ›", size: "xs", color: "#2563EB", margin: "sm", action: { type: "uri", label: "查看詳情", uri } });
  return { type: "box", layout: "vertical", margin: first ? "none" : "lg", contents: lines, action: { type: "uri", label: "查看詳情", uri } };
}
// 某位社友的「所有行程」（地區＋所屬社＋本人私人；已取消不列），全天在前、其餘依開始時間
export async function eventsOfPerson(admin: Any, club: string, key: string, from: number, to: number): Promise<Any[]> {
  const base = () => admin.from("calendar_events").select("*").gte("end_at", new Date(from).toISOString()).lte("start_at", new Date(to).toISOString()).neq("status", "cancelled").order("start_at").limit(200);
  const [d, c, p] = await Promise.all([
    base().eq("layer", "district"),
    base().eq("layer", "club").eq("club_name", club),
    base().eq("layer", "private").eq("club_name", club).eq("owner_key", key),
  ]);
  for (const r of [d, c, p]) if (r.error) dbFail(r.error);
  return [...(d.data || []), ...(c.data || []), ...(p.data || [])].filter((e: Any) => e.status !== "cancelled")
    .sort((a: Any, b: Any) => Number(!!b.all_day) - Number(!!a.all_day) || Date.parse(a.start_at) - Date.parse(b.start_at));
}
// 一位總監明天的卡片（Flex Message）。events 已依開始時間排序
export function buildDigestMessage(gov: { name: string; nickname?: string }, day: string, events: Any[], liffId: string, test = false, tomorrow = true, alt2?: { title: string; sub: string }): Any {
  const [y, m, d] = day.split("-").map(Number);
  const wd = DIGEST_WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const dayText = `${m}/${d}（${wd}）`;
  const base = `https://liff.line.me/${liffId}?p=calendar`;
  const MAX = 10, shown = events.slice(0, MAX);
  const items: Any[] = [];
  shown.forEach((e, i) => {
    if (i) items.push({ type: "separator", margin: "lg" });
    items.push(eventBox(e, day, base, i === 0));
  });
  if (events.length > MAX) items.push({ type: "text", text: `還有 ${events.length - MAX} 個行程，請開啟行事曆查看。`, size: "sm", color: "#64748B", margin: "lg", wrap: true });
  const who = gov.nickname ? `${gov.name} ${gov.nickname}` : gov.name;
  const first = events[0];
  const when = tomorrow ? "明天 " : "";
  const alt = `${test ? "【測試】" : ""}${alt2 ? "🔔" : "📅"} ${when}${dayText}有 ${events.length} 個${alt2 ? "活動" : "行程"}：${digestTimeText(first, day)} ${first.title}${events.length > 1 ? " 等" : ""}`.slice(0, 390);
  return {
    type: "flex", altText: alt,
    contents: {
      type: "bubble", size: "mega",
      header: { type: "box", layout: "vertical", backgroundColor: "#1E3A8A", paddingAll: "16px", contents: [
        { type: "text", text: `${test ? "【測試】" : ""}${alt2 ? `🔔 ${alt2.title}` : `📅 ${tomorrow ? "明天的行程" : "行程"}`}（${events.length}）`, color: "#FFFFFF", weight: "bold", size: "lg", wrap: true },
        { type: "text", text: alt2 ? `${dayText}・${alt2.sub}` : `${dayText}・總監 ${who}`, color: "#BFDBFE", size: "sm", margin: "sm", wrap: true },
      ] },
      body: { type: "box", layout: "vertical", paddingAll: "16px", contents: items },
      footer: { type: "box", layout: "vertical", contents: [
        { type: "button", style: "primary", color: "#1E3A8A", height: "sm", action: { type: "uri", label: "開啟行事曆", uri: base } },
      ] },
    },
  };
}
export async function governorDigest(admin: Any, o: DigestOpts): Promise<Any> {
  const now = o.now || Date.now();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(o.day || "")) ? String(o.day) : tpYmd(now + 86400_000);
  const from = Date.parse(`${day}T00:00:00+08:00`), to = Date.parse(`${day}T23:59:59+08:00`);
  if (!Number.isFinite(from)) fail("CAL_BAD_TIME");
  const { data: roles, error } = await admin.from("calendar_roles").select("club_name,person_key,full_name,nickname,role").in("role", ["governor", "governor_cc"]);
  if (error) dbFail(error);
  const govs = (roles || []).filter((r: Any) => r.role === "governor");
  const ccs = (roles || []).filter((r: Any) => r.role === "governor_cc");
  const out: Any = { ok: true, day, test: !!o.test, sent: 0, governors: [] as Any[] };
  if (!govs.length) { out.note = "NO_GOVERNOR"; return out; }
  const bindingOf = async (club: string, key: string) => {
    const { data, error: e } = await admin.from("line_bindings").select("line_user_id").eq("club_name", club).eq("person_key", key).maybeSingle();
    if (e) dbFail(e);
    return data ? String(data.line_user_id) : "";
  };
  for (const g of govs) {
    // 推播內容＝總監「私人」頁的行程（使用者 2026-11-19 決定）：總監的私人行程＋總監已參加的地區／社內活動
    // （按了「我要參加」或已被執秘正式報名）。沒有表示參加的地區、社內行程不推。
    const all = await eventsOfPerson(admin, g.club_name, g.person_key, from, to);
    const joined = await joinedMap(admin, all, { club: g.club_name, key: g.person_key, name: g.full_name || "", nickname: g.nickname || "" }, o.reg);
    const events = all.filter((e: Any) => e.layer === "private" || joined.has(e.id));
    const govKey = `${g.club_name}|${g.person_key}`;
    const item: Any = { name: g.full_name, nickname: g.nickname || "", club: g.club_name, events: events.map((e: Any) => ({ id: e.id, layer: e.layer, title: e.title, time: digestTimeText(e, day), location: e.location || e.address || "", dressCode: e.dress_code || "" })), recipients: [] as Any[] };
    out.governors.push(item);
    const to2 = [{ ...g, as: "總監" }, ...ccs.filter((x: Any) => !(x.club_name === g.club_name && x.person_key === g.person_key)).map((x: Any) => ({ ...x, as: "總監秘書（副本）" }))];
    const seen = new Set<string>();
    const msg = events.length ? buildDigestMessage({ name: g.full_name, nickname: g.nickname }, day, events, o.liffId, !!o.test, day === tpYmd(now + 86400_000)) : null;
    if (msg) item.altText = msg.altText;
    for (const r of to2) {
      const rk = `${r.club_name}|${r.person_key}`;
      if (seen.has(rk)) continue;
      seen.add(rk);
      const rec: Any = { name: r.full_name, nickname: r.nickname || "", club: r.club_name, as: r.as, status: "" };
      item.recipients.push(rec);
      const uid = await bindingOf(r.club_name, r.person_key);
      if (!uid) { rec.status = "NOT_BOUND"; continue; }
      if (!msg) { rec.status = "NO_EVENTS"; continue; }
      if (!o.send) { rec.status = "PREVIEW"; continue; }
      if (!o.test) {
        const { data: done, error: e1 } = await admin.from("calendar_digest_log").select("day").eq("day", day).eq("gov_key", govKey).eq("to_key", rk).maybeSingle();
        if (e1) dbFail(e1);
        if (done) { rec.status = "ALREADY"; continue; }
      }
      try {
        await o.send(uid, [msg]);
        rec.status = "SENT"; out.sent++;
        if (!o.test) {
          const { error: e2 } = await admin.from("calendar_digest_log").insert({ day, gov_key: govKey, to_key: rk, events: events.length });
          if (e2) console.error("總監推播紀錄寫入失敗", e2.message || e2);
        }
      } catch (e: Any) { rec.status = "FAILED"; console.error("總監推播失敗", (e && e.message) || e); }
    }
  }
  return out;
}

// =====================================================================
// 各社活動提醒推播：管理者在行事曆後台逐社開放（預設關閉）。開放的社，系統在「活動前一天」的指定整點（預設晚上 8 點）
// 提醒該社「明天有活動、而且已經表示參加或已正式報名」的社友（地區＋社內活動；私人行程不提醒）。
//   - 一位社友一則卡片，列出他明天參加的所有活動。要綁定過 LINE 才收得到。
//   - 不重複：同一個活動×同一位社友×同一天只推一次（表 calendar_push_sent）。活動主委在報名系統發的推播也會寫進這張表，
//     所以主委當天已經推過的人，這裡就不再提醒那個活動（event_ref＝對應的報名活動 key；沒有對應報名活動的行程＝cal:<行程id>）。
//   - 總監、總監秘書已經有「總監每日推播」，這裡不再提醒他們。
// =====================================================================
export const CLUB_PUSH_HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
export const CLUB_PUSH_DEFAULT_HOUR = 20;
export const pushRef = (e: Any) => (e.registration_key ? String(e.registration_key) : `cal:${e.id}`);
export async function loadClubPush(admin: Any): Promise<{ club: string; enabled: boolean; hour: number }[]> {
  const { data, error } = await admin.from("calendar_club_push").select("club_name,enabled,hour");
  if (error) dbFail(error);
  return (data || []).map((r: Any) => ({ club: String(r.club_name), enabled: !!r.enabled, hour: Number(r.hour) }));
}
export interface ClubRemindOpts {
  liffId: string;
  send?: (to: string, messages: Any[]) => Promise<void>;   // 沒給＝只預覽
  reg?: RegDeps;
  now?: number;
  club?: string;        // 只處理這一社（後台預覽／立即發送，不看設定的時間）；沒給＝排程：處理「開放、而且時間＝現在這個整點」的社
}
export async function clubReminder(admin: Any, o: ClubRemindOpts): Promise<Any> {
  const now = o.now || Date.now();
  const today = tpYmd(now), day = tpYmd(now + 86400_000), hour = Number(tpHm(now).slice(0, 2));
  const from = Date.parse(`${day}T00:00:00+08:00`), to = Date.parse(`${day}T23:59:59+08:00`);
  const clubs = o.club ? [o.club] : (await loadClubPush(admin)).filter((c) => c.enabled && c.hour === hour).map((c) => c.club);
  const out: Any = { ok: true, day, today, hour, sent: 0, clubs: [] as Any[] };
  if (!clubs.length) return out;
  // 地區活動每個社都一樣，只查一次
  const base = () => admin.from("calendar_events").select("*").gte("end_at", new Date(from).toISOString()).lte("start_at", new Date(to).toISOString()).neq("status", "cancelled").order("start_at").limit(200);
  const dq = await base().eq("layer", "district");
  if (dq.error) dbFail(dq.error);
  const rosterCache = new Map<string, Any[]>();
  const rosterOf = async (key: string) => {
    if (!rosterCache.has(key)) { let ps: Any[] = []; try { const ro = o.reg ? await o.reg.roster(key) : null; if (ro && ro.ok) ps = ro.persons || []; } catch (_e) { ps = []; } rosterCache.set(key, ps); }
    return rosterCache.get(key)!;
  };
  for (const club of clubs) {
    const item: Any = { club, events: [] as Any[], recipients: [] as Any[], sent: 0 };
    out.clubs.push(item);
    const cq = await base().eq("layer", "club").eq("club_name", club);
    if (cq.error) dbFail(cq.error);
    // 只提醒「明天開始」的活動（多天活動只在開始的前一天提醒），全天在前、其餘依開始時間
    const events: Any[] = [...(dq.data || []), ...(cq.data || [])].filter((e: Any) => e.status !== "cancelled" && tpYmd(Date.parse(e.start_at)) === day)
      .sort((a: Any, b: Any) => Number(!!b.all_day) - Number(!!a.all_day) || Date.parse(a.start_at) - Date.parse(b.start_at));
    item.events = events.map((e: Any) => ({ id: e.id, layer: e.layer, title: e.title, time: digestTimeText(e, day) }));
    if (!events.length) continue;
    // 誰參加：按了「我要參加」（含執秘代登記；非社友同行者不算）＋已被執秘正式報名
    const people = new Map<string, { key: string; name: string; nickname: string; evs: Set<string> }>();
    const join = (key: string, name: string, nickname: string, evId: string) => {
      if (!key || isExtGuestKey(key)) return;
      let p = people.get(key); if (!p) { p = { key, name: name || key.split("|")[0], nickname: nickname || "", evs: new Set() }; people.set(key, p); }
      p.evs.add(evId);
    };
    const rq = await admin.from("calendar_rsvp").select("event_id,person_key,full_name,nickname").eq("club_name", club).in("event_id", events.map((e: Any) => e.id));
    if (rq.error) dbFail(rq.error);
    (rq.data || []).forEach((r: Any) => join(String(r.person_key), r.full_name, r.nickname, String(r.event_id)));
    for (const e of events) {
      if (!e.registration_key) continue;
      (await rosterOf(String(e.registration_key))).filter((p: Any) => p.club === club).forEach((p: Any) => join(String(p.key), p.name, p.nickname, String(e.id)));
    }
    if (!people.size) continue;
    const [bq, gq, sq] = await Promise.all([
      admin.from("line_bindings").select("line_user_id,person_key,full_name").eq("club_name", club),
      admin.from("calendar_roles").select("person_key,role").eq("club_name", club).in("role", ["governor", "governor_cc"]),
      admin.from("calendar_push_sent").select("event_ref,person_key").eq("sent_day", today).eq("club_name", club),
    ]);
    for (const q of [bq, gq, sq]) if (q.error) dbFail(q.error);
    const uidByKey = new Map<string, string>(), uidsByName = new Map<string, string[]>();
    (bq.data || []).forEach((b: Any) => { uidByKey.set(String(b.person_key), String(b.line_user_id)); uidsByName.set(b.full_name, (uidsByName.get(b.full_name) || []).concat(String(b.line_user_id))); });
    const govKeys = new Set((gq.data || []).map((r: Any) => String(r.person_key)));
    const done = new Set((sq.data || []).map((r: Any) => `${r.event_ref}\u0001${r.person_key}`));
    const jobs: Any[] = [];
    for (const p of people.values()) {
      const mine = events.filter((e: Any) => p.evs.has(String(e.id)));
      const todo = mine.filter((e: Any) => !done.has(`${pushRef(e)}\u0001${p.key}`));
      const rec: Any = { name: p.name, nickname: p.nickname, events: todo.length, already: mine.length - todo.length, status: "" };
      item.recipients.push(rec);
      if (govKeys.has(p.key)) { rec.status = "GOV_DIGEST"; continue; }
      const same = uidsByName.get(p.name) || [];
      const uid = uidByKey.get(p.key) || (same.length === 1 ? same[0] : "");
      if (!uid) { rec.status = "NOT_BOUND"; continue; }
      if (!todo.length) { rec.status = "ALREADY"; continue; }
      if (!o.send) { rec.status = "PREVIEW"; continue; }
      jobs.push({ p, rec, uid, todo });
    }
    for (let i = 0; i < jobs.length; i += 8) {
      await Promise.all(jobs.slice(i, i + 8).map(async (j: Any) => {
        const who = j.p.nickname ? `${j.p.nickname} ${j.p.name}` : j.p.name;
        try {
          await o.send!(j.uid, [buildDigestMessage({ name: j.p.name, nickname: j.p.nickname }, day, j.todo, o.liffId, false, true, { title: "明天的活動提醒", sub: `${club}・${who}` })]);
          j.rec.status = "SENT"; item.sent++; out.sent++;
          const refs = Array.from(new Set(j.todo.map(pushRef)));
          const { error: e2 } = await admin.from("calendar_push_sent").upsert(refs.map((ref) => ({ sent_day: today, event_ref: ref, club_name: club, person_key: j.p.key, source: "club" })), { onConflict: "sent_day,event_ref,club_name,person_key", ignoreDuplicates: true });
          if (e2) console.error("活動提醒紀錄寫入失敗", e2.message || e2);
        } catch (e: Any) { j.rec.status = "FAILED"; console.error("活動提醒發送失敗", (e && e.message) || e); }
      }));
    }
  }
  return out;
}

// =====================================================================
// LINE 聊天室關鍵字回覆（Webhook）：社友在官方帳號聊天室傳「行事曆」「今天」「明天」「本週」，
// 系統依綁定身分回覆他自己的行程卡片（地區＋所屬社＋本人私人）。回覆（reply）不算推播額度。
// 只有「整句剛好是關鍵字」才回覆（例如「明天見」不會觸發），其他訊息不處理，交給官方帳號原本的自動回應。
// =====================================================================
export type AgendaRange = "two" | "today" | "tomorrow" | "week";
const AGENDA_WORDS: Record<AgendaRange, string[]> = {
  two: ["行事曆", "行程", "我的行程", "查行程", "查詢行程", "行程查詢", "最近行程", "calendar", "schedule"],
  today: ["今天", "今日", "今天行程", "今天的行程", "今日行程", "today"],
  tomorrow: ["明天", "明日", "明天行程", "明天的行程", "明日行程", "tomorrow"],
  week: ["本週", "本周", "這週", "這周", "這禮拜", "這星期", "本週行程", "本周行程", "這週行程", "一週", "一週行程", "7天", "七天", "week"],
};
export function parseAgendaKeyword(text: string): AgendaRange | null {
  const t = String(text || "").replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[\s　?？!！。．.、~～]/g, "").toLowerCase();
  if (!t || t.length > 12) return null;
  for (const k of Object.keys(AGENDA_WORDS) as AgendaRange[]) if (AGENDA_WORDS[k].includes(t)) return k;
  return null;
}
const AGENDA_TITLE: Record<AgendaRange, string> = { two: "今天＋明天的行程", today: "今天的行程", tomorrow: "明天的行程", week: "最近 7 天的行程" };
const AGENDA_DAYS: Record<AgendaRange, [number, number]> = { two: [0, 1], today: [0, 0], tomorrow: [1, 1], week: [0, 6] };
const HINT = "也可以傳：今天、明天、本週";
// me＝綁定的社友（沒綁定＝null）。回傳要回覆的訊息陣列
export async function agendaReply(admin: Any, me: { club: string; key: string; name: string; nickname?: string } | null, range: AgendaRange, liffId: string, now = Date.now()): Promise<Any[]> {
  const home = `https://liff.line.me/${liffId}`;
  if (!me) {
    return [{ type: "text", text: `您好！要查自己的行程，請先綁定扶輪身分（只要一次）：\n${home}\n\n綁定後在這裡傳「行事曆」，就會回覆您今天和明天的行程。` }];
  }
  const base = `${home}?p=calendar`;
  const [a, b] = AGENDA_DAYS[range];
  const days: string[] = [];
  for (let i = a; i <= b; i++) days.push(tpYmd(now + i * 86400_000));
  const from = Date.parse(`${days[0]}T00:00:00+08:00`), to = Date.parse(`${days[days.length - 1]}T23:59:59+08:00`);
  const all = await eventsOfPerson(admin, me.club, me.key, from, to);
  const today = tpYmd(now), tomorrow = tpYmd(now + 86400_000);
  const label = (day: string) => {
    const [y, m, d] = day.split("-").map(Number);
    const wd = DIGEST_WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
    return `${m}/${d}（${wd}）${day === today ? " 今天" : day === tomorrow ? " 明天" : ""}`;
  };
  const MAX = 12;
  let shown = 0, total = 0;
  const items: Any[] = [];
  for (const day of days) {
    const ds = Date.parse(`${day}T00:00:00+08:00`), de = Date.parse(`${day}T23:59:59+08:00`);
    const evs = all.filter((e: Any) => Date.parse(e.start_at) <= de && Date.parse(e.end_at) >= ds);
    total += evs.length;
    if (range === "week" && !evs.length) continue;          // 7 天的清單不列空白的日子
    if (shown >= MAX) continue;
    items.push({ type: "box", layout: "vertical", backgroundColor: "#E2E8F0", cornerRadius: "6px", paddingAll: "6px", margin: items.length ? "xl" : "none", contents: [{ type: "text", text: label(day), weight: "bold", size: "sm", color: "#1E293B" }] });
    if (!evs.length) { items.push({ type: "text", text: "沒有行程", size: "sm", color: "#94A3B8", margin: "md" }); continue; }
    evs.forEach((e: Any, i: number) => {
      if (shown >= MAX) return;
      if (i) items.push({ type: "separator", margin: "lg" });
      const box = eventBox(e, day, base, false);
      box.margin = i ? "lg" : "md";
      items.push(box);
      shown++;
    });
  }
  if (total > shown) items.push({ type: "text", text: `還有 ${total - shown} 個行程，請開啟行事曆查看。`, size: "sm", color: "#64748B", margin: "lg", wrap: true });
  if (!total) items.push({ type: "text", text: range === "week" ? "最近 7 天沒有行程。" : "這段期間沒有行程。", size: "sm", color: "#64748B", margin: "md", wrap: true });
  const who = me.nickname ? `${me.name} ${me.nickname}` : me.name;
  const alt = total ? `📅 ${AGENDA_TITLE[range]}：共 ${total} 個` : `📅 ${AGENDA_TITLE[range]}：沒有行程`;
  return [{
    type: "flex", altText: alt,
    contents: {
      type: "bubble", size: "mega",
      header: { type: "box", layout: "vertical", backgroundColor: "#1E3A8A", paddingAll: "16px", contents: [
        { type: "text", text: `📅 ${AGENDA_TITLE[range]}`, color: "#FFFFFF", weight: "bold", size: "lg", wrap: true },
        { type: "text", text: `${who}・${me.club}`, color: "#BFDBFE", size: "sm", margin: "sm", wrap: true },
      ] },
      body: { type: "box", layout: "vertical", paddingAll: "16px", contents: items },
      footer: { type: "box", layout: "vertical", spacing: "sm", contents: [
        { type: "button", style: "primary", color: "#1E3A8A", height: "sm", action: { type: "uri", label: "開啟行事曆", uri: base } },
        { type: "text", text: HINT, size: "xs", color: "#94A3B8", align: "center", margin: "sm" },
      ] },
    },
  }];
}

// ---------- 後台動作（電腦版 admin-calendar.html，用後台密碼把關） ----------
export interface AdminCtx { admin: Any; password: string; members: () => Promise<Record<string, Any[]>>; clubInfos: () => Promise<{ name: string; division: string; code: string }[]>; sendLine?: (to: string, messages: Any[]) => Promise<void>; reg?: RegDeps; statEvents?: () => Promise<{ key: string; catName: string; subName: string }[]> }
// 執秘代登記的「同行者」（不在社友庫：子女、外勞、朋友，或社友庫沒有資料的寶尊眷）：person_key＝guest:<帶他來的社友 key>:<序號>
const EXT_GUEST_PREFIX = "guest:";
export const EXT_GUEST_TYPES = ["寶(尊)眷", "子女", "外勞", "朋友", "其他"];
const isExtGuestKey = (k: Any) => String(k || "").startsWith(EXT_GUEST_PREFIX);
// 這一筆「表示參加」是不是寶尊眷：社友帶來的（guest_of），或執秘代登記時社友庫標為寶尊眷的（guest_role）
const rsvpIsGuest = (r: Any) => !!(r && (r.guest_of || r.guest_role));
const personKey = (p: Any) => `${(p && p.name) || ""}|${(p && p.nickname) || ""}`;

// 讀取／設定「誰可以在 LINE 看全社出席率」：行事曆後台（任何一社）與報名系統的執秘（只限自己的社）共用。
// save 時 body.reset＝恢復預設（刪掉這一列）；否則 body.keys＝勾選的人（只收這社社友庫裡的人）。
export async function reportViewersAction(admin: Any, club: string, members: Any[], body: Any, save: boolean, by: string): Promise<Any> {
  const list: Any[] = (Array.isArray(members) ? members : []).filter((m: Any) => m && m.name);
  if (save) {
    if (body.reset) {
      const { error } = await admin.from("calendar_report_viewers").delete().eq("club_name", club);
      if (error) dbFail(error);
    } else {
      if (!Array.isArray(body.keys)) fail("BAD_REQUEST");
      const valid = new Set(list.map(personKey));
      const keys = [...new Set<string>(body.keys.map((k: Any) => String(k)))].filter((k) => valid.has(k)).slice(0, 200);
      const { error } = await admin.from("calendar_report_viewers").upsert(
        { club_name: club, viewers: keys, updated_by: by.slice(0, 60), updated_at: new Date().toISOString() },
        { onConflict: "club_name" });
      if (error) dbFail(error);
    }
  }
  const { data: row, error: e2 } = await admin.from("calendar_report_viewers").select("viewers,updated_by,updated_at").eq("club_name", club).maybeSingle();
  if (e2 && !/does not exist|schema cache|could not find|PGRST20[25]|42P01/i.test(String(e2.message || "") + " " + String(e2.code || ""))) dbFail(e2);
  const viewers: string[] | null = row && Array.isArray(row.viewers) ? row.viewers.map(String) : null;
  const C = coreOf();
  const sorted = C && C.sortMembers ? C.sortMembers(list) : list;
  return {
    ok: true, club, custom: viewers !== null,
    updatedBy: viewers ? String(row.updated_by || "") : "", updatedAt: viewers ? String(row.updated_at || "") : "",
    members: sorted.map((m: Any) => ({
      key: personKey(m), name: m.name, nickname: m.nickname || "", role: m.role || "",
      spouse: !!m.spouseOfId || /眷/.test(String(m.role || "")),
      isDefault: memberRank(m) <= 1, allowed: canViewClubReport(m, viewers),
    })),
  };
}

async function reportCustomClubs(admin: Any): Promise<{ club: string; count: number }[]> {
  const { data, error } = await admin.from("calendar_report_viewers").select("club_name,viewers");
  if (error) return [];      // 資料表還沒建立時，後台其他功能照常
  return (data || []).map((r: Any) => ({ club: r.club_name, count: Array.isArray(r.viewers) ? r.viewers.length : 0 }));
}

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
      reportCustomClubs: await reportCustomClubs(admin),
    };
  }

  // ---------- 誰可以在 LINE 看全社出席率（每社自己的文化不同，由這裡逐社設定） ----------
  if (action === "cal_admin_viewers_get" || action === "cal_admin_viewers_save") {
    const club = String(body.club || "");
    if (!(await ctx.clubInfos()).some((c) => c.name === club)) fail("BAD_REQUEST");
    const raw = (await ctx.members())[club];
    return await reportViewersAction(admin, club, Array.isArray(raw) ? raw : [], body, action === "cal_admin_viewers_save", "行事曆後台");
  }

  // ---------- 誰可以在 LINE 看活動的報名／繳費狀況（逐活動指定個人，可多選、可跨社；event_key＝* 是全部活動） ----------
  if (action === "cal_admin_statviewers_get" || action === "cal_admin_statviewers_save") {
    const events = ctx.statEvents ? await ctx.statEvents() : [];
    if (action === "cal_admin_statviewers_save") {
      const eventKey = String(body.eventKey || "");
      if (eventKey !== STAT_ALL && !events.some((e) => e.key === eventKey)) fail("BAD_REQUEST");
      const all = await ctx.members();
      const seen = new Set<string>(), rows: Any[] = [];
      for (const p of Array.isArray(body.people) ? body.people.slice(0, 200) : []) {      // 只收社友庫裡的人
        const club = String((p && p.club) || ""), key = String((p && p.key) || "");
        const m = (Array.isArray(all[club]) ? all[club] : []).find((x: Any) => x && personKey(x) === key);
        if (!m || seen.has(club + "\u0001" + key)) continue;
        seen.add(club + "\u0001" + key);
        rows.push({ event_key: eventKey, club_name: club, person_key: key, full_name: m.name || "", nickname: m.nickname || "" });
      }
      const del = await admin.from("calendar_stat_viewers").delete().eq("event_key", eventKey);
      if (del.error) dbFail(del.error);
      if (rows.length) { const ins = await admin.from("calendar_stat_viewers").insert(rows); if (ins.error) dbFail(ins.error); }
    }
    const { data, error } = await admin.from("calendar_stat_viewers").select("*");
    if (error) dbFail(error);
    return {
      ok: true, events,
      viewers: (data || []).map((r: Any) => ({ eventKey: r.event_key, club: r.club_name, key: r.person_key, name: r.full_name, nickname: r.nickname })),
    };
  }

  // ---------- 備份提醒的收件人（系統管理者，可多人＝備援人員）、目前到期的活動、測試發送 ----------
  if (action === "cal_admin_backupnotify_get" || action === "cal_admin_backupnotify_save" || action === "cal_admin_backupnotify_test") {
    if (action === "cal_admin_backupnotify_save") {
      const all = await ctx.members();
      const seen = new Set<string>(), list: BackupPerson[] = [];
      for (const p of Array.isArray(body.people) ? body.people.slice(0, 20) : []) {      // 只收社友庫裡的人，最多 20 位
        const club = String((p && p.club) || ""), key = String((p && p.key) || "");
        const m = (Array.isArray(all[club]) ? all[club] : []).find((x: Any) => x && personKey(x) === key);
        if (!m || seen.has(club + "\u0001" + key)) continue;
        seen.add(club + "\u0001" + key);
        list.push({ club, key, name: m.name || "", nickname: m.nickname || "" });
      }
      const up = await admin.from("calendar_settings").upsert({ key: BACKUP_NOTIFY_KEY, value: JSON.stringify(list) }, { onConflict: "key" });
      if (up.error) dbFail(up.error);
    }
    if (!ctx.reg || !ctx.reg.stats) fail("CAL_REG_UNAVAILABLE");
    if (action === "cal_admin_backupnotify_test") {
      if (!ctx.sendLine) fail("PUSH_DISABLED");
      return await backupReminder(admin, { stats: ctx.reg!.stats!, send: ctx.sendLine, test: true });
    }
    return { ...(await backupReminder(admin, { stats: ctx.reg!.stats! })), afterDays: BACKUP_REMIND_AFTER_DAYS };
  }

  // ---------- 各社活動提醒推播：逐社開放（預設關閉）、設定前一天幾點推、預覽、立即發送 ----------
  if (action === "cal_admin_clubpush_get" || action === "cal_admin_clubpush_save" || action === "cal_admin_clubpush_preview" || action === "cal_admin_clubpush_send") {
    if (action !== "cal_admin_clubpush_get") {
      const club = String(body.club || "");
      if (!(await ctx.clubInfos()).some((c) => c.name === club)) fail("BAD_REQUEST");
      if (action === "cal_admin_clubpush_save") {
        if (body.enabled === false) {
          const { error } = await admin.from("calendar_club_push").delete().eq("club_name", club);
          if (error) dbFail(error);
        } else {
          const hour = Number(body.hour);
          if (!CLUB_PUSH_HOURS.includes(hour)) fail("BAD_REQUEST");
          const { error } = await admin.from("calendar_club_push").upsert({ club_name: club, enabled: true, hour, updated_at: new Date().toISOString() }, { onConflict: "club_name" });
          if (error) dbFail(error);
        }
      } else {
        const liffId = String(body.liffId || "");
        if (!/^[\w-]{5,80}$/.test(liffId)) fail("BAD_REQUEST");
        const send = action === "cal_admin_clubpush_send";
        if (send && !ctx.sendLine) fail("PUSH_DISABLED");
        if (send && !(await loadClubPush(admin)).some((c) => c.club === club && c.enabled)) fail("CAL_CLUB_PUSH_OFF");
        return await clubReminder(admin, { club, liffId, send: send ? ctx.sendLine : undefined, reg: ctx.reg });
      }
    }
    return { ok: true, hours: CLUB_PUSH_HOURS, defaultHour: CLUB_PUSH_DEFAULT_HOUR, clubs: (await loadClubPush(admin)).filter((c) => c.enabled) };
  }

  // ---------- 總監每日推播：預覽（不發送）、測試發送（立刻發、標「測試」、不記錄） ----------
  if (action === "cal_admin_digest_preview" || action === "cal_admin_digest_test") {
    const liffId = String(body.liffId || "");
    if (!/^[\w-]{5,80}$/.test(liffId)) fail("BAD_REQUEST");
    if (action === "cal_admin_digest_test" && !ctx.sendLine) fail("PUSH_DISABLED");
    return await governorDigest(admin, { day: body.day, liffId, test: action === "cal_admin_digest_test", send: action === "cal_admin_digest_test" ? ctx.sendLine : undefined, reg: ctx.reg });
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
    if (!["district_editor", "club_editor", "governor", "governor_cc"].includes(role)) fail("BAD_REQUEST");
    const list = (await ctx.members())[club];
    const m = (Array.isArray(list) ? list : []).find((x: Any) => x && x.name && personKey(x) === key);
    if (!m) fail("MEMBER_NOT_FOUND");
    const managedClub = role === "club_editor" ? String(body.managedClub || club) : "";
    if (role === "club_editor" && !(await ctx.clubInfos()).some((c) => c.name === managedClub)) fail("BAD_REQUEST");
    // 總監秘書與總監必須是同一社（秘書才能代管總監的行事曆、同步參加活動）
    if (role === "governor" || role === "governor_cc") {
      const { data: pair, error: e0 } = await admin.from("calendar_roles").select("club_name").eq("role", role === "governor" ? "governor_cc" : "governor");
      if (e0) dbFail(e0);
      if ((pair || []).some((x: Any) => x.club_name !== club)) fail("CAL_GOV_CLUB_MISMATCH");
    }
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
