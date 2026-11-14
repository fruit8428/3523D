// =====================================================================
// LINE 自助報到的核心邏輯（index.ts 與本機測試共用）。
// 這裡不直接連 LINE、也不直接建立資料庫連線：由呼叫端傳入 deps，
// 所以本機測試可以換成假的「LINE 身分驗證」，其餘程式與正式環境完全相同。
//
// 重要原則：
//  - 絕不相信前端回報的 LINE 使用者代碼，一律以 idToken 向 LINE 驗證後取得。
//  - 應到名單用 checkin-core.js 的 buildRoster（與櫃台報到頁、主委面板同一套算法）。
//    這個資料夾裡的 checkin-core.js 是專案根目錄那一份的複本，根目錄的改了要一起複製過來。
// =====================================================================
import "./checkin-core.js";
// deno-lint-ignore no-explicit-any
type Any = any;
const Core = (globalThis as Any).CheckinCore;

export const MAIN_KEY = "rotary_3523_spa_data_v3"; // 報名主資料（key 名稱各地區相同，刻意不改）

export interface LineUser { sub: string; name: string }
export interface Deps {
  admin: Any;                                          // supabase-js（service_role）
  verify: (idToken: string) => Promise<LineUser>;      // 向 LINE 驗證 idToken；失敗丟出 AppError
  broadcast: (eventKey: string) => Promise<void>;      // 通知櫃台報到頁有人報到（失敗沒關係，櫃台 8 秒內會自己抓到）
  defaultClubPassword: string;                         // 地區的各社預設密碼（沒有就空字串）
}
export class AppError extends Error {
  code: string;
  constructor(code: string, message?: string) { super(message || code); this.code = code; }
}
const fail = (code: string, message?: string): never => { throw new AppError(code, message); };

const personKey = (p: Any) => `${(p && p.name) || ""}|${(p && p.nickname) || ""}`;

async function loadState(deps: Deps, withMembers: boolean) {
  const cols = "cats:value->categoriesData,divs:value->divisionsData,orders:value->registrationOrders" +
    (withMembers ? ",members:value->clubMemberDatabase,auth:value->appAuthData" : "");
  const { data, error } = await deps.admin.from("app_storage").select(cols).eq("key", MAIN_KEY).maybeSingle();
  if (error) fail("SERVER_ERROR", error.message);
  return {
    categoriesData: (data && data.cats) || [],
    divisionsData: (data && data.divs) || [],
    registrationOrders: (data && data.orders) || {},
    members: (data && data.members) || {},
    auth: (data && data.auth) || {},
  };
}

function dbFail(error: Any): never {
  const msg = (error && error.message) || String(error || "");
  if (/CHECKIN_CLOSED/.test(msg)) fail("CHECKIN_CLOSED");
  if (/does not exist|schema cache|could not find|PGRST20[25]|42P01|42883/i.test(msg + " " + ((error && error.code) || ""))) fail("TABLE_MISSING");
  return fail("SERVER_ERROR", msg);
}

async function getBinding(deps: Deps, sub: string) {
  const { data, error } = await deps.admin.from("line_bindings").select("club_name,person_key,full_name,nickname,bound_at").eq("line_user_id", sub).maybeSingle();
  if (error) dbFail(error);
  return data ? { club: data.club_name, key: data.person_key, name: data.full_name, nickname: data.nickname, boundAt: data.bound_at } : null;
}

// 在某社的應到名單裡找出綁定的那個人：先比「姓名|Nick Name」，找不到再比姓名（該社只有一位同名時）
function findInRoster(persons: Any[], club: string, key: string, name: string) {
  const mine = persons.filter((p) => p.club === club);
  const exact = mine.find((p) => p.key === key);
  if (exact) return exact;
  const byName = mine.filter((p) => p.name && p.name === name);
  return byName.length === 1 ? byName[0] : null;
}

// 家人＝社友庫裡互為「寶(尊)眷」關係的人（眷屬 ↔ 對應的社友，以及同一位社友的其他眷屬）
function familyKeys(members: Any[], myKey: string, myName: string): string[] {
  const list = Array.isArray(members) ? members : [];
  const me = list.find((m) => personKey(m) === myKey) || list.find((m) => m.name === myName);
  if (!me) return [];
  const headId = me.spouseOfId || me.id;
  if (headId === undefined || headId === null) return [];
  return list.filter((m) => m !== me && (m.id === headId || m.spouseOfId === headId)).map(personKey);
}

async function eventView(deps: Deps, state: Any, eventKey: string, binding: Any) {
  const roster = Core.buildRoster(state, eventKey);
  const out: Any = { key: eventKey, title: roster.title || "", ok: roster.ok, reason: roster.reason || "", isOpen: false, hasClosed: false, me: null, companions: [] };
  if (!roster.ok) return { out, roster, mine: null, rows: [] as Any[] };
  const ev = await deps.admin.from("checkin_events").select("is_open,closed_at").eq("event_key", eventKey).maybeSingle();
  if (ev.error) dbFail(ev.error);
  out.isOpen = !!(ev.data && ev.data.is_open);
  out.hasClosed = !!(ev.data && ev.data.closed_at);
  if (!binding) return { out, roster, mine: null, rows: [] as Any[] };
  const { data: rows, error } = await deps.admin.from("event_checkins").select("person_key,status,checked_in_at,is_walk_in,full_name,nickname")
    .eq("event_key", eventKey).eq("club_name", binding.club);
  if (error) dbFail(error);
  const rowOf = (k: string) => (rows || []).find((r: Any) => r.person_key === k) || null;
  let mine = findInRoster(roster.persons, binding.club, binding.key, binding.name);
  // 不在報名名單，但櫃台已先幫他「現場加報（還沒到）」：也可以自助報到
  if (!mine) {
    const pend = (rows || []).find((r: Any) => (r.status === "pending" || r.status === "in") && r.is_walk_in && (r.person_key === binding.key || r.full_name === binding.name));
    if (pend) mine = { club: binding.club, key: pend.person_key, name: pend.full_name, nickname: pend.nickname || "", walkIn: true };
  }
  if (mine) {
    const r = rowOf(mine.key);
    const tags: string[] = [];
    if (mine.walkIn) tags.push("現場加報");
    if (mine.diet === "VEGAN") tags.push(mine.veganNote || "素食");
    if (mine.pelsOption) tags.push(Core.PELS_SHORT[mine.pelsOption] || mine.pelsOption);
    if (mine.participation) tags.push(mine.participation);
    out.me = { registered: true, key: mine.key, name: mine.name, nickname: mine.nickname, arrived: !!(r && r.status === "in"), time: r && r.status === "in" ? r.checked_in_at : null, tags };
    const fam = familyKeys(state.members[binding.club], binding.key, binding.name);
    out.companions = roster.persons.filter((p: Any) => p.club === binding.club && p.key !== mine.key && fam.includes(p.key)).map((p: Any) => {
      const cr = rowOf(p.key);
      return { key: p.key, name: p.name, nickname: p.nickname, arrived: !!(cr && cr.status === "in") };
    });
  } else {
    out.me = { registered: false };
  }
  return { out, roster, mine, rows: rows || [] };
}

function checkClubPassword(deps: Deps, state: Any, club: string, password: string) {
  const stored = ((state.auth || {}).clubPasswords || {})[club];
  const expected = stored || deps.defaultClubPassword || "";
  if (!club || !expected || String(password || "") !== String(expected)) fail("CLUB_AUTH_FAILED");
}

export async function handle(body: Any, deps: Deps): Promise<Any> {
  const action = String((body && body.action) || "");

  // ---------- 執秘：查看／解除本社的 LINE 綁定（用該社的登入密碼確認，與報名系統本身的防護程度相同） ----------
  if (action === "club_bindings" || action === "club_unbind") {
    const club = String(body.club || "");
    const state = await loadState(deps, true);
    checkClubPassword(deps, state, club, body.clubPassword);
    if (action === "club_unbind") {
      const { error } = await deps.admin.from("line_bindings").delete().eq("club_name", club).eq("person_key", String(body.personKey || ""));
      if (error) dbFail(error);
    }
    const { data, error } = await deps.admin.from("line_bindings").select("person_key,full_name,nickname,display_name,bound_at").eq("club_name", club).order("bound_at");
    if (error) dbFail(error);
    // 不回傳 LINE 使用者代碼
    return { ok: true, bindings: (data || []).map((r: Any) => ({ key: r.person_key, name: r.full_name, nickname: r.nickname, displayName: r.display_name || "", boundAt: r.bound_at })) };
  }

  // ---------- 以下都要先向 LINE 驗證身分 ----------
  const user = await deps.verify(String((body && body.idToken) || ""));

  if (action === "init") {
    const state = await loadState(deps, true);
    const binding = await getBinding(deps, user.sub);
    const res: Any = {
      ok: true, displayName: user.name, binding,
      divisions: (state.divisionsData || []).map((d: Any) => ({ name: d.name || `第 ${d.id} 分區`, clubs: (d.clubs || []).map((c: Any) => c.name) })).filter((d: Any) => d.clubs.length),
    };
    if (body.eventKey) res.event = (await eventView(deps, state, String(body.eventKey), binding)).out;
    return res;
  }

  if (action === "members") {
    const club = String(body.club || "");
    const state = await loadState(deps, true);
    const { data, error } = await deps.admin.from("line_bindings").select("person_key").eq("club_name", club);
    if (error) dbFail(error);
    const taken = new Set((data || []).map((r: Any) => r.person_key));
    const list = (Array.isArray(state.members[club]) ? state.members[club] : []).filter((m: Any) => m && m.name)
      .map((m: Any) => ({ key: personKey(m), name: m.name, nickname: m.nickname || "", role: m.role || "", taken: taken.has(personKey(m)) }));
    return { ok: true, members: list };
  }

  if (action === "bind") {
    const club = String(body.club || ""), key = String(body.personKey || "");
    const state = await loadState(deps, true);
    const member = (Array.isArray(state.members[club]) ? state.members[club] : []).find((m: Any) => m && m.name && personKey(m) === key);
    if (!member) fail("MEMBER_NOT_FOUND");      // 只能綁社友庫裡的人，不接受自由輸入
    if (await getBinding(deps, user.sub)) fail("ALREADY_BOUND");
    const { error } = await deps.admin.from("line_bindings").insert({ line_user_id: user.sub, club_name: club, person_key: key, full_name: member.name, nickname: member.nickname || "", display_name: user.name || null });
    if (error) {
      if (error.code === "23505" || /duplicate key/i.test(error.message || "")) {
        // 可能是這個名字被別人綁走，也可能是自己同時送了兩次
        const again = await getBinding(deps, user.sub);
        if (again && again.club === club && again.key === key) return { ok: true, binding: again };
        fail(again ? "ALREADY_BOUND" : "NAME_TAKEN");
      }
      dbFail(error);
    }
    return { ok: true, binding: await getBinding(deps, user.sub) };
  }

  if (action === "unbind_self") {
    const { error } = await deps.admin.from("line_bindings").delete().eq("line_user_id", user.sub);
    if (error) dbFail(error);
    return { ok: true, binding: null };
  }

  if (action === "checkin") {
    const eventKey = String(body.eventKey || "");
    const binding = await getBinding(deps, user.sub);
    if (!binding) fail("NOT_BOUND");
    const state = await loadState(deps, true);
    const view = await eventView(deps, state, eventKey, binding);
    if (!view.out.ok) fail(view.out.reason === "apportionment" ? "EVENT_NO_CHECKIN" : "EVENT_NOT_FOUND");
    if (!view.out.isOpen) fail("CHECKIN_CLOSED");
    if (!view.mine) fail("NOT_REGISTERED");
    const allowed = new Set(view.out.companions.map((c: Any) => c.key));
    const wanted: string[] = (Array.isArray(body.companionKeys) ? body.companionKeys : []).map(String).filter((k: string) => allowed.has(k));
    const targets = [view.mine].concat(view.roster.persons.filter((p: Any) => p.club === binding!.club && wanted.includes(p.key)));
    for (let i = 0; i < targets.length; i++) {
      const p = targets[i];
      const by = i === 0 ? "LINE 自助" : `LINE（${binding!.name} 代）`;
      const { error } = await deps.admin.rpc("line_checkin_mark", { p_event_key: eventKey, p_club: binding!.club, p_person_key: p.key, p_full_name: p.name || p.nickname, p_nickname: p.nickname || "", p_by: by });
      if (error) dbFail(error);
    }
    try { await deps.broadcast(eventKey); } catch (_e) { /* 櫃台會自己抓到 */ }
    const after = await eventView(deps, state, eventKey, binding);
    return { ok: true, binding, event: after.out };
  }

  return fail("BAD_REQUEST");
}
