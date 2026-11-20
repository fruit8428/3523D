// 社費推播：執秘在報名系統填共同品項與個別品項，用 LINE 推給每位社友「他自己的社費明細」。
//   - 開放方式：沿用行事曆後台「④-2 各社推播開放」（calendar_club_push 有這個社＝開放）。沒開放的社，雲端一律擋下。
//   - 身分：社的登入密碼（lib.ts 先用 checkClubPassword 確認，與 LINE 綁定名單同一做法）。不設推播密碼、不限次數（使用者決定）。
//   - 每人的金額是個資：只存在 club_dues_state（上次填的內容）與推播本身，前端讀不到這兩張表。
//   - 算法只有一份：checkin-core.js 的 duesCompute（畫面的小計與這裡實際推出去的內容一定相同）。
// deno-lint-ignore-file no-explicit-any
type Any = any;
export interface DuesCtx {
  admin: Any;
  club: string;
  members: Any[];                                              // 這個社的社友庫
  core: Any;                                                   // CheckinCore
  send?: (to: string, messages: Any[]) => Promise<void>;       // 沒有＝這個地區還沒設定官方帳號 token
  fail: (code: string, message?: string) => never;
  now?: number;
}
const missing = (error: Any) => /does not exist|schema cache|could not find|PGRST20[25]|42P01/i.test(((error && error.message) || "") + " " + ((error && error.code) || ""));

async function isOpen(ctx: DuesCtx): Promise<boolean> {
  const { data, error } = await ctx.admin.from("calendar_club_push").select("enabled").eq("club_name", ctx.club).maybeSingle();
  if (error) { if (missing(error)) return false; ctx.fail("SERVER_ERROR", error.message); }
  return !!(data && data.enabled);
}
// 這個社每位社友綁定的 LINE：先比「姓名|Nick Name」，找不到再比姓名（該姓名只有一個綁定時）
async function uidFinder(ctx: DuesCtx): Promise<(p: { key: string; name: string }) => string> {
  const { data, error } = await ctx.admin.from("line_bindings").select("line_user_id,person_key,full_name").eq("club_name", ctx.club);
  if (error) { if (missing(error)) return () => ""; ctx.fail("SERVER_ERROR", error.message); }
  const byKey = new Map<string, string>(), byName = new Map<string, string[]>();
  (data || []).forEach((b: Any) => { byKey.set(String(b.person_key), String(b.line_user_id)); byName.set(b.full_name, (byName.get(b.full_name) || []).concat(String(b.line_user_id))); });
  return (p) => { const same = byName.get(p.name) || []; return byKey.get(p.key) || (same.length === 1 ? same[0] : ""); };
}
async function history(ctx: DuesCtx): Promise<Any[]> {
  const { data, error } = await ctx.admin.from("club_dues_log").select("period,target_count,sent_count,failed_count,unbound_count,total_amount,sent_at").eq("club_name", ctx.club).order("sent_at", { ascending: false }).limit(10);
  if (error) { if (missing(error)) ctx.fail("DUES_TABLE_MISSING"); ctx.fail("SERVER_ERROR", error.message); }
  return (data || []).map((r: Any) => ({ period: r.period, targets: r.target_count, sent: r.sent_count, failed: r.failed_count, unbound: r.unbound_count, total: Number(r.total_amount) || 0, at: r.sent_at }));
}
async function sha256(text: string): Promise<string> {
  const buf = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 一位社友的卡片（Flex Message）：只有他自己的明細
export function buildDuesMessage(core: Any, club: string, info: Any, p: { name: string; nickname: string; items: { name: string; amount: number }[]; total: number }): Any {
  const money = core.duesMoney;
  const title = `【${club}】${info.period || "社費"}`;
  const row = (l: string, r: string, bold = false) => ({ type: "box", layout: "horizontal", margin: "sm", contents: [
    { type: "text", text: l, size: bold ? "md" : "sm", color: bold ? "#0F172A" : "#334155", weight: bold ? "bold" : "regular", flex: 5, wrap: true },
    { type: "text", text: r, size: bold ? "lg" : "sm", color: bold ? "#B91C1C" : "#0F172A", weight: bold ? "bold" : "regular", flex: 4, align: "end" },
  ] });
  const body: Any[] = [
    { type: "text", text: `${p.name}${p.nickname ? " " + p.nickname : ""} 社友您好`, size: "md", weight: "bold", color: "#0F172A", wrap: true },
    { type: "separator", margin: "md" },
    ...p.items.map((it) => row(it.name, money(it.amount))),
    { type: "separator", margin: "md" },
    row("合計", `NT$ ${money(p.total)}`, true),
  ];
  if (info.due) body.push({ type: "text", text: `繳費期限：${info.due}`, size: "sm", color: "#334155", margin: "lg", wrap: true });
  if (info.method) body.push({ type: "text", text: `繳費方式：${info.method}`, size: "sm", color: "#334155", margin: info.due ? "sm" : "lg", wrap: true });
  if (info.note) body.push({ type: "text", text: info.note, size: "sm", color: "#64748B", margin: "md", wrap: true });
  return {
    type: "flex", altText: `${title}：合計 NT$ ${money(p.total)}${info.due ? `，繳費期限 ${info.due}` : ""}`.slice(0, 390),
    contents: { type: "bubble", size: "mega",
      header: { type: "box", layout: "vertical", backgroundColor: "#1E3A8A", paddingAll: "16px", contents: [{ type: "text", text: title, color: "#FFFFFF", weight: "bold", size: "lg", wrap: true }] },
      body: { type: "box", layout: "vertical", paddingAll: "16px", contents: body } },
  };
}

export async function handleDues(action: string, body: Any, ctx: DuesCtx): Promise<Any> {
  const open = await isOpen(ctx);
  if (action === "club_dues_status") return { ok: true, enabled: open };
  if (!open) ctx.fail("DUES_CLUB_OFF");
  const Core = ctx.core;

  if (action === "club_dues_get") {
    const { data, error } = await ctx.admin.from("club_dues_state").select("data,updated_at").eq("club_name", ctx.club).maybeSingle();
    if (error) { if (missing(error)) ctx.fail("DUES_TABLE_MISSING"); ctx.fail("SERVER_ERROR", error.message); }
    const uidOf = await uidFinder(ctx);
    const people = Core.duesCompute(ctx.members, {});
    return { ok: true, enabled: true, canSend: !!ctx.send, last: data ? data.data : null, lastAt: data ? data.updated_at : null,
      bound: people.filter((p: Any) => !!uidOf(p)).map((p: Any) => p.key), history: await history(ctx) };
  }

  if (action === "club_dues_send") {
    if (!ctx.send) ctx.fail("PUSH_DISABLED");
    const form = Core.duesNormalize(body.form);
    if (!form.info.period) ctx.fail("DUES_NO_PERIOD");
    const everyone = Core.duesCompute(ctx.members, form);
    const valid = new Set(everyone.map((p: Any) => p.key));
    Object.keys(form.members).forEach((k) => { if (!valid.has(k)) delete form.members[k]; });   // 已不在社友庫（或是寶尊眷）的設定不保留
    const people = everyone.filter((p: Any) => p.total !== 0);      // 小計為 0 的人不推
    if (!people.length) ctx.fail("DUES_NO_TARGET");
    const uidOf = await uidFinder(ctx);
    const bound = people.map((p: Any) => ({ p, uid: uidOf(p) })).filter((x: Any) => x.uid);
    const unbound = people.filter((p: Any) => !uidOf(p));
    if (!bound.length) ctx.fail("DUES_NO_BOUND");
    // 防止誤按兩次：60 秒內送過一模一樣的內容就擋下（不是限制次數）
    const hash = await sha256(JSON.stringify([form.info, people]));
    const now = ctx.now || Date.now();
    const last = await ctx.admin.from("club_dues_log").select("content_hash,sent_at").eq("club_name", ctx.club).order("sent_at", { ascending: false }).limit(1);
    if (last.error) { if (missing(last.error)) ctx.fail("DUES_TABLE_MISSING"); ctx.fail("SERVER_ERROR", last.error.message); }
    if (last.data && last.data[0] && last.data[0].content_hash === hash && now - Date.parse(last.data[0].sent_at) < 60_000) ctx.fail("DUES_DUPLICATE");
    // 同一個 LINE 帳號只收一則
    const seen = new Set<string>();
    const list = bound.filter((x: Any) => (seen.has(x.uid) ? false : (seen.add(x.uid), true)));
    let sent = 0, failed = 0;
    const failedNames: string[] = [];
    for (let i = 0; i < list.length; i += 8) {
      await Promise.all(list.slice(i, i + 8).map(async (x: Any) => {
        try { await ctx.send!(x.uid, [buildDuesMessage(Core, ctx.club, form.info, x.p)]); sent++; }
        catch (e: Any) { failed++; failedNames.push(x.p.name); console.error("社費推播失敗", (e && e.message) || e); }
      }));
    }
    // 記住這次填的內容（下次自動帶出）與發送紀錄。寫入失敗不影響已經送出的推播
    const st = await ctx.admin.from("club_dues_state").upsert({ club_name: ctx.club, data: form, updated_at: new Date(now).toISOString() }, { onConflict: "club_name" });
    if (st.error) console.error("社費內容儲存失敗", st.error.message);
    const lg = await ctx.admin.from("club_dues_log").insert({ club_name: ctx.club, period: form.info.period, target_count: people.length, sent_count: sent, failed_count: failed, unbound_count: unbound.length,
      total_amount: people.reduce((n: number, p: Any) => n + p.total, 0), content_hash: hash, sent_at: new Date(now).toISOString() });
    if (lg.error) console.error("社費發送紀錄寫入失敗", lg.error.message);
    console.log("社費推播", JSON.stringify({ club: ctx.club, targets: people.length, sent, failed, unbound: unbound.length }));
    return { ok: true, targets: people.length, sent, failed, failedNames, unbound: unbound.map((p: Any) => ({ name: p.name, nickname: p.nickname })), history: await history(ctx) };
  }
  return ctx.fail("BAD_REQUEST");
}
