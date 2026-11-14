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
  push?: PushDeps;                                     // LINE 推播（沒有開放的地區不提供）
}
// LINE 推播：要用「LINE 官方帳號」的 Messaging API 才能主動傳訊息給社友（LINE Login 頻道不行）。
// token 或 password 任一個是空的＝這個地區沒有開放推播。
export interface PushDeps {
  token: string;                                       // 官方帳號的 Channel access token（有值才算開放）
  password: string;                                    // 推播密碼（由系統管理者設定，交給獲准使用的地區）
  send: (userIds: string[], text: string) => Promise<void>;                       // 傳送文字訊息；失敗丟出例外
  quota: () => Promise<{ limit: number | null; used: number } | null>;            // 本月額度與已用則數；查不到回 null
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

// ---------- LINE 推播：選出要通知的報名者 ----------
// filter：{ clubs?: 社名[]（不給＝全部）, status?: 'all'|'absent'|'arrived', participation?: 'all'|'參賽'|'只用餐' }
// 只通知「報名名單上的人」（現場加報的不算）；有綁定 LINE 的才有 uid。
async function selectPushTargets(deps: Deps, eventKey: string, filter: Any) {
  const state = await loadState(deps, false);
  const roster = Core.buildRoster(state, eventKey);
  if (!roster.ok) fail(roster.reason === "apportionment" ? "EVENT_NO_CHECKIN" : "EVENT_NOT_FOUND");
  const rows: Any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await deps.admin.from("event_checkins").select("club_name,person_key,status,is_walk_in").eq("event_key", eventKey).order("id").range(from, from + 999);
    if (error) dbFail(error);
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const f = filter || {};
  const clubSet = Array.isArray(f.clubs) ? new Set(f.clubs.map(String)) : null;
  const status = f.status === "absent" || f.status === "arrived" ? f.status : "all";
  const part = f.participation === "參賽" || f.participation === "只用餐" ? f.participation : "all";
  const entries = Core.mergeCheckins(roster, rows, state.divisionsData).filter((e: Any) =>
    !e.isWalkIn && !e.isOrphan &&
    (!clubSet || clubSet.has(e.club)) &&
    (status === "all" || (status === "arrived" ? !!e.checkin : !e.checkin)) &&
    (part === "all" || e.participation === part));
  const clubs = Array.from(new Set(entries.map((e: Any) => e.club)));
  const binds: Any[] = [];
  for (let i = 0; i < clubs.length; i += 50) {
    const { data, error } = await deps.admin.from("line_bindings").select("line_user_id,club_name,person_key,full_name").in("club_name", clubs.slice(i, i + 50));
    if (error) dbFail(error);
    binds.push(...(data || []));
  }
  const byKey = new Map<string, string>(), byName = new Map<string, string[]>();
  binds.forEach((b) => {
    byKey.set(b.club_name + "\u0001" + b.person_key, b.line_user_id);
    const k = b.club_name + "\u0001" + b.full_name;
    byName.set(k, (byName.get(k) || []).concat(b.line_user_id));
  });
  const targets = entries.map((e: Any) => {
    const same = byName.get(e.club + "\u0001" + e.name) || [];
    return { club: e.club, divName: e.divName, name: e.name || e.nickname, nickname: e.nickname || "", uid: byKey.get(e.club + "\u0001" + e.key) || (same.length === 1 ? same[0] : null) };
  });
  return { title: roster.title || "", targets };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function requirePush(deps: Deps, body: Any): Promise<PushDeps> {
  const push = deps.push;
  if (!push || !push.token || !push.password) return fail("PUSH_DISABLED");
  if (String((body && body.pushPassword) || "") !== push!.password) { await sleep(1000); fail("PUSH_AUTH_FAILED"); }   // 故意等 1 秒，降低被猜密碼的速度
  return push!;
}

export async function handle(body: Any, deps: Deps): Promise<Any> {
  const action = String((body && body.action) || "");

  // ---------- LINE 推播（活動主委用；以「推播密碼」確認，沒有開放的地區一律拒絕） ----------
  if (action === "push_status") {
    return { ok: true, enabled: !!(deps.push && deps.push.token && deps.push.password) };
  }
  if (action === "push_preview" || action === "push_send" || action === "push_history") {
    const push = await requirePush(deps, body);
    const eventKey = String(body.eventKey || "");
    if (action === "push_history") {
      const { data, error } = await deps.admin.from("line_push_log").select("sent_at,sender,message,target_count,sent_count,failed_count,unbound_count").eq("event_key", eventKey).order("sent_at", { ascending: false }).limit(10);
      if (error) dbFail(error);
      return { ok: true, history: data || [] };
    }
    const sel = await selectPushTargets(deps, eventKey, body.filter);
    const bound = sel.targets.filter((t: Any) => t.uid);
    const unbound = sel.targets.filter((t: Any) => !t.uid);
    if (action === "push_preview") {
      let quota = null;
      try { quota = await push.quota(); } catch (_e) { quota = null; }
      return { ok: true, title: sel.title, total: sel.targets.length, bound: bound.length, unbound: unbound.slice(0, 500).map((t: Any) => ({ club: t.club, name: t.name })), quota };
    }
    // ---- push_send ----
    const message = String(body.message || "").trim();
    if (!message) fail("PUSH_EMPTY_MESSAGE");
    if (message.length > 1000) fail("PUSH_MESSAGE_TOO_LONG");
    if (!bound.length) fail("PUSH_NO_TARGET");
    // 防止連點：同一個活動 60 秒內送過一模一樣的訊息就擋下
    const last = await deps.admin.from("line_push_log").select("message,sent_at").eq("event_key", eventKey).order("sent_at", { ascending: false }).limit(1);
    if (last.error) dbFail(last.error);
    if (last.data && last.data[0] && last.data[0].message === message && Date.now() - Date.parse(last.data[0].sent_at) < 60_000) fail("PUSH_DUPLICATE");
    const base = message.split("{活動名稱}").join(sel.title);
    const personal = base.includes("{姓名}") || base.includes("{社名}");
    // 同一個 LINE 帳號只收一則
    const seen = new Set<string>();
    const list = bound.filter((t: Any) => (seen.has(t.uid) ? false : (seen.add(t.uid), true)));
    let sent = 0, failed = 0;
    if (personal) {
      // 內容含個人化變數：一人一則，分批同時送出
      for (let i = 0; i < list.length; i += 8) {
        await Promise.all(list.slice(i, i + 8).map(async (t: Any) => {
          try { await push.send([t.uid], base.split("{姓名}").join(t.name).split("{社名}").join(t.club)); sent++; } catch (_e) { failed++; }
        }));
      }
    } else {
      for (let i = 0; i < list.length; i += 500) {
        const chunk = list.slice(i, i + 500);
        try { await push.send(chunk.map((t: Any) => t.uid), base); sent += chunk.length; } catch (_e) { failed += chunk.length; }
      }
    }
    const log = await deps.admin.from("line_push_log").insert({ event_key: eventKey, sender: String(body.sender || "").slice(0, 60) || null, filter: body.filter || {}, message, target_count: sel.targets.length, sent_count: sent, failed_count: failed, unbound_count: unbound.length });
    if (log.error) console.error("推播紀錄寫入失敗", log.error.message);
    return { ok: true, total: sel.targets.length, sent, failed, unbound: unbound.length };
  }

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
